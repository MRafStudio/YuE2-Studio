//! A YuE2 adapter as one ComfyUI LoRA file.
//!
//! The studio keeps a trained adapter as two files, one per half of the
//! backbone (`native-ar.safetensors` for the score, `native-nar.safetensors`
//! for the sound), in the engine's own tensor names. ComfyUI's native YuE2
//! loads one file with the stock LoRA loader, keyed by its module names: the
//! planner half under `text_encoders.model.layers.N`, the acoustic half under
//! `diffusion_model.model.layers.N` (ComfyUI names the NAR expert with the AR
//! module names), with q, k, v fused into `self_attn.qkv_proj` and gate, up
//! into `mlp.gate_up_proj` (rows q | k | v and gate | up).
//!
//! A fused module takes one adapter, so the separate q, k, v adapters are
//! written as one LoRA whose factors are the separate ones stacked: `up` block
//! diagonal, `down` stacked, the delta of each block exactly its own. A LoKr
//! site kron(w1, A B) is the LoRA kron(I_a, A) . kron(w1, B) by the mixed
//! product rule, exact, of rank a * dim where `a` is w1's row count. Modules
//! that are not fused keep their LoKr or LoRA as they are. The strength of
//! every fused block is folded into its `down`, so the file needs no alpha
//! there and ComfyUI's scale is one.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{bail, Context, Result};
use serde_json::{Map, Value};

/// One tensor read from a safetensors file, as F32.
#[derive(Debug, Clone)]
pub struct Tensor {
    pub shape: Vec<usize>,
    pub data: Vec<f32>,
}

impl Tensor {
    fn rows(&self) -> usize {
        self.shape.first().copied().unwrap_or(1)
    }

    fn cols(&self) -> usize {
        self.shape.get(1).copied().unwrap_or(1)
    }

    fn at(&self, row: usize, col: usize) -> f32 {
        self.data[row * self.cols() + col]
    }
}

/// A safetensors file: its tensors as F32 and its metadata.
pub struct SafeTensors {
    pub tensors: BTreeMap<String, Tensor>,
    pub metadata: Map<String, Value>,
}

pub fn read(path: &Path) -> Result<SafeTensors> {
    let bytes = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
    let length = u64::from_le_bytes(bytes.get(..8).context("not a safetensors file")?.try_into()?) as usize;
    let header: Map<String, Value> = serde_json::from_slice(bytes.get(8..8 + length).context("a safetensors header past the end of the file")?)?;
    let data = &bytes[8 + length..];
    let mut tensors = BTreeMap::new();
    let mut metadata = Map::new();
    for (name, entry) in header {
        if name == "__metadata__" {
            metadata = entry.as_object().cloned().unwrap_or_default();
            continue;
        }
        let dtype = entry.get("dtype").and_then(Value::as_str).context("a tensor without a dtype")?;
        let shape: Vec<usize> = entry.get("shape").and_then(Value::as_array).context("a tensor without a shape")?.iter().filter_map(Value::as_u64).map(|size| size as usize).collect();
        let offsets: Vec<usize> = entry.get("data_offsets").and_then(Value::as_array).context("a tensor without offsets")?.iter().filter_map(Value::as_u64).map(|offset| offset as usize).collect();
        let raw = data.get(offsets[0]..offsets[1]).with_context(|| format!("{name} lies past the end of the file"))?;
        let values = match dtype {
            "F32" => raw.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect(),
            "BF16" => raw.chunks_exact(2).map(|b| f32::from_bits((u16::from_le_bytes([b[0], b[1]]) as u32) << 16)).collect(),
            "F16" => raw.chunks_exact(2).map(|b| f16_to_f32(u16::from_le_bytes([b[0], b[1]]))).collect(),
            other => bail!("{name} is {other}; only F32, BF16 and F16 adapters are read"),
        };
        tensors.insert(name, Tensor { shape, data: values });
    }
    Ok(SafeTensors { tensors, metadata })
}

/// Writes BF16 tensors, as trainers ship LoRA, with the metadata as text.
pub fn write(path: &Path, tensors: &BTreeMap<String, Tensor>, metadata: &BTreeMap<String, String>) -> Result<()> {
    let mut header = Map::new();
    header.insert("__metadata__".into(), serde_json::to_value(metadata)?);
    let mut offset = 0usize;
    for (name, tensor) in tensors {
        let size = tensor.data.len() * 2;
        header.insert(name.clone(), serde_json::json!({ "dtype": "BF16", "shape": tensor.shape, "data_offsets": [offset, offset + size] }));
        offset += size;
    }
    let mut json = serde_json::to_vec(&header)?;
    while json.len() % 8 != 0 {
        json.push(b' ');
    }
    let mut out = Vec::with_capacity(8 + json.len() + offset);
    out.extend_from_slice(&(json.len() as u64).to_le_bytes());
    out.extend_from_slice(&json);
    for tensor in tensors.values() {
        for value in &tensor.data {
            out.extend_from_slice(&f32_to_bf16(*value).to_le_bytes());
        }
    }
    let partial = path.with_extension("safetensors.part");
    std::fs::write(&partial, out).with_context(|| format!("write {}", partial.display()))?;
    std::fs::rename(&partial, path).with_context(|| format!("move into {}", path.display()))?;
    Ok(())
}

fn f16_to_f32(bits: u16) -> f32 {
    let sign = ((bits >> 15) as u32) << 31;
    let exponent = ((bits >> 10) & 0x1f) as u32;
    let mantissa = (bits & 0x3ff) as u32;
    let value = match (exponent, mantissa) {
        (0, 0) => sign,
        (0, _) => {
            let mut e = 127 - 15 + 1;
            let mut m = mantissa;
            while m & 0x400 == 0 {
                m <<= 1;
                e -= 1;
            }
            sign | (e << 23) | ((m & 0x3ff) << 13)
        }
        (0x1f, _) => sign | 0x7f80_0000 | (mantissa << 13),
        _ => sign | ((exponent + 127 - 15) << 23) | (mantissa << 13),
    };
    f32::from_bits(value)
}

/// Round to nearest even, as torch casts to bfloat16.
fn f32_to_bf16(value: f32) -> u16 {
    let bits = value.to_bits();
    if value.is_nan() {
        return 0x7fc0;
    }
    let rounding = 0x7fff + ((bits >> 16) & 1);
    ((bits + rounding) >> 16) as u16
}

/// One site's adapter as the studio keeps it, before fusion.
enum Site {
    /// LoRA: delta = scale * up @ down.
    Lora { up: Tensor, down: Tensor, scale: f32 },
    /// LoKr: delta = scale * kron(w1, a @ b), with its alpha kept for ComfyUI.
    Lokr { w1: Tensor, a: Tensor, b: Tensor, scale: f32, alpha: Option<Tensor> },
}

impl Site {
    /// This site as LoRA factors (up [out, r], down [r, in]) with its whole
    /// strength in `down`.
    fn as_lora(&self) -> (Tensor, Tensor) {
        match self {
            Site::Lora { up, down, scale } => (up.clone(), scaled(down, *scale)),
            Site::Lokr { w1, a, b, scale, .. } => {
                // kron(w1, A B) = kron(I_a, A) . kron(w1, B)
                let (rows_w1, cols_w1) = (w1.rows(), w1.cols());
                let (p, dim) = (a.rows(), a.cols());
                let q = b.cols();
                let rank = rows_w1 * dim;
                let mut up = vec![0.0f32; rows_w1 * p * rank];
                for block in 0..rows_w1 {
                    for row in 0..p {
                        for col in 0..dim {
                            up[(block * p + row) * rank + block * dim + col] = a.at(row, col);
                        }
                    }
                }
                let width = cols_w1 * q;
                let mut down = vec![0.0f32; rank * width];
                for i in 0..rows_w1 {
                    for j in 0..cols_w1 {
                        let factor = w1.at(i, j) * scale;
                        for row in 0..dim {
                            for col in 0..q {
                                down[(i * dim + row) * width + j * q + col] = factor * b.at(row, col);
                            }
                        }
                    }
                }
                (Tensor { shape: vec![rows_w1 * p, rank], data: up }, Tensor { shape: vec![rank, width], data: down })
            }
        }
    }
}

fn scaled(tensor: &Tensor, scale: f32) -> Tensor {
    Tensor { shape: tensor.shape.clone(), data: tensor.data.iter().map(|value| value * scale).collect() }
}

/// Stacks the sites of one fused module - q, k, v or gate, up - as one LoRA:
/// `up` block diagonal over the output rows, `down` stacked. A part without
/// an adapter contributes zero rows of its own height.
fn fuse(parts: &[(Option<&Site>, usize)], width: usize) -> Option<(Tensor, Tensor)> {
    let factors: Vec<(Option<(Tensor, Tensor)>, usize)> = parts.iter().map(|(site, rows)| (site.map(Site::as_lora), *rows)).collect();
    let rank: usize = factors.iter().filter_map(|(factor, _)| factor.as_ref().map(|(up, _)| up.cols())).sum();
    if rank == 0 {
        return None;
    }
    let height: usize = factors.iter().map(|(_, rows)| rows).sum();
    let mut up = vec![0.0f32; height * rank];
    let mut down = vec![0.0f32; rank * width];
    let (mut row0, mut rank0) = (0, 0);
    for (factor, rows) in &factors {
        if let Some((part_up, part_down)) = factor {
            let r = part_up.cols();
            for row in 0..*rows {
                for col in 0..r {
                    up[(row0 + row) * rank + rank0 + col] = part_up.at(row, col);
                }
            }
            down[rank0 * width..(rank0 + r) * width].copy_from_slice(&part_down.data);
            rank0 += r;
        }
        row0 += rows;
    }
    Some((Tensor { shape: vec![height, rank], data: up }, Tensor { shape: vec![rank, width], data: down }))
}

/// The engine's name of a site and the ComfyUI module it belongs to.
const ATTENTION: [&str; 3] = ["attn_q", "attn_k", "attn_v"];
const MLP: [&str; 2] = ["ffn_gate", "ffn_up"];

/// The sites of one half, by block and engine site name ("attn_q", ...).
fn sites(file: &SafeTensors, strength: f32) -> Result<BTreeMap<(usize, String), Site>> {
    let lokr_dim = file.metadata.get("lokr_dim").and_then(Value::as_str).and_then(|value| value.parse::<f32>().ok());
    let meta_alpha = file.metadata.get("alpha").and_then(Value::as_str).and_then(|value| value.parse::<f32>().ok());
    let mut grouped: BTreeMap<(usize, String), BTreeMap<String, Tensor>> = BTreeMap::new();
    for (name, tensor) in &file.tensors {
        let rest = name.strip_prefix("yue2.blk.").with_context(|| format!("{name} is not a tensor of the studio's own adapter format"))?;
        let (block, rest) = rest.split_once('.').context("a tensor without a block")?;
        let (site, part) = rest.rsplit_once('.').context("a tensor without a part")?;
        let site = site.strip_prefix("nar_").unwrap_or(site).to_string();
        let part = part.trim_end_matches(".weight").to_string();
        grouped.entry((block.parse()?, site)).or_default().insert(part, tensor.clone());
    }
    let mut out = BTreeMap::new();
    for ((block, site), mut parts) in grouped {
        let alpha_tensor = parts.remove("alpha");
        let alpha = alpha_tensor.as_ref().and_then(|tensor| tensor.data.first().copied()).or(meta_alpha);
        let entry = if let (Some(w1), Some(a), Some(b)) = (parts.remove("lokr_w1"), parts.remove("lokr_w2_a"), parts.remove("lokr_w2_b")) {
            let dim = lokr_dim.unwrap_or(a.cols() as f32);
            let scale = strength * alpha.map_or(1.0, |alpha| alpha / dim);
            Site::Lokr { w1, a, b, scale, alpha: alpha_tensor.or_else(|| alpha.map(|alpha| Tensor { shape: vec![], data: vec![alpha] })) }
        } else if let (Some(down), Some(up)) = (parts.remove("lora_A").or_else(|| parts.remove("lora_down")), parts.remove("lora_B").or_else(|| parts.remove("lora_up"))) {
            let rank = down.rows() as f32;
            Site::Lora { up, down, scale: strength * alpha.map_or(1.0, |alpha| alpha / rank) }
        } else {
            bail!("block {block} {site} is neither a LoKr nor a LoRA");
        };
        out.insert((block, site), entry);
    }
    Ok(out)
}

/// The rows each fused part has in the backbone, from the adapter itself.
fn out_rows(site: &Site) -> usize {
    match site {
        Site::Lora { up, .. } => up.rows(),
        Site::Lokr { w1, a, .. } => w1.rows() * a.rows(),
    }
}

fn in_cols(site: &Site) -> usize {
    match site {
        Site::Lora { down, .. } => down.cols(),
        Site::Lokr { w1, b, .. } => w1.cols() * b.cols(),
    }
}

/// The ComfyUI tensors of one half under `prefix`.
fn half(sites: &BTreeMap<(usize, String), Site>, prefix: &str, rows: &BTreeMap<String, usize>, out: &mut BTreeMap<String, Tensor>) -> Result<()> {
    let blocks: Vec<usize> = sites.keys().map(|(block, _)| *block).collect::<std::collections::BTreeSet<_>>().into_iter().collect();
    for block in blocks {
        let at = |site: &str| sites.get(&(block, site.to_string()));
        for (group, module, width_of) in [(&ATTENTION[..], "self_attn.qkv_proj", "attn_q"), (&MLP[..], "mlp.gate_up_proj", "ffn_gate")] {
            let present: Vec<&Site> = group.iter().filter_map(|site| at(site)).collect();
            let Some(first) = present.first() else { continue };
            let width = in_cols(first);
            let parts: Vec<(Option<&Site>, usize)> = group
                .iter()
                .map(|site| {
                    let height = at(site).map(out_rows).or_else(|| rows.get(*site).copied());
                    height.map(|height| (at(site), height)).with_context(|| format!("block {block}: no size known for the missing {site} next to {width_of}"))
                })
                .collect::<Result<_>>()?;
            if let Some((up, down)) = fuse(&parts, width) {
                out.insert(format!("{prefix}.{block}.{module}.lora_up.weight"), up);
                out.insert(format!("{prefix}.{block}.{module}.lora_down.weight"), down);
            }
        }
        for (site, module) in [("attn_output", "self_attn.o_proj"), ("ffn_down", "mlp.down_proj")] {
            match at(site) {
                Some(Site::Lokr { w1, a, b, alpha, .. }) => {
                    out.insert(format!("{prefix}.{block}.{module}.lokr_w1"), w1.clone());
                    out.insert(format!("{prefix}.{block}.{module}.lokr_w2_a"), a.clone());
                    out.insert(format!("{prefix}.{block}.{module}.lokr_w2_b"), b.clone());
                    if let Some(alpha) = alpha {
                        out.insert(format!("{prefix}.{block}.{module}.alpha"), alpha.clone());
                    }
                }
                Some(lora @ Site::Lora { .. }) => {
                    let (up, down) = lora.as_lora();
                    out.insert(format!("{prefix}.{block}.{module}.lora_up.weight"), up);
                    out.insert(format!("{prefix}.{block}.{module}.lora_down.weight"), down);
                }
                None => {}
            }
        }
        for site in sites.keys().filter(|(b, _)| *b == block).map(|(_, site)| site.as_str()) {
            let known = ATTENTION.contains(&site) || MLP.contains(&site) || site == "attn_output" || site == "ffn_down";
            if !known {
                bail!("block {block} has an adapter on {site}, which ComfyUI's YuE2 has no module for");
            }
        }
    }
    Ok(())
}

/// The heights of q, k, v and gate, up in YuE2-3B, for a fused module whose
/// adapter left one of them out.
fn yue2_rows() -> BTreeMap<String, usize> {
    [("attn_q", 2048), ("attn_k", 1024), ("attn_v", 1024), ("ffn_gate", 6144), ("ffn_up", 6144)].into_iter().map(|(site, rows)| (site.to_string(), rows)).collect()
}

/// Which half of YuE2 a file of the studio's own adapter format adapts: the
/// planner (AR) or the sound (NAR). None for a file in any other format.
pub fn yue2_half(path: &Path) -> Result<Option<bool>> {
    let bytes = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
    let length = u64::from_le_bytes(bytes.get(..8).context("not a safetensors file")?.try_into()?) as usize;
    let header: Map<String, Value> = serde_json::from_slice(bytes.get(8..8 + length).context("a safetensors header past the end of the file")?)?;
    let names: Vec<&String> = header.keys().filter(|name| *name != "__metadata__").collect();
    if names.is_empty() || !names.iter().all(|name| name.starts_with("yue2.blk.")) {
        return Ok(None);
    }
    Ok(Some(names.iter().any(|name| name.contains(".nar_"))))
}

/// A YuE2 adapter - its planner file, its sound file, or both - as one
/// ComfyUI LoRA at `out`, the strength of each half folded in. Returns how
/// many tensors were written.
pub fn export_yue2(ar: Option<&Path>, nar: Option<&Path>, ar_strength: f32, nar_strength: f32, out: &Path, name: &str, trigger: Option<&str>) -> Result<usize> {
    let mut tensors = BTreeMap::new();
    let rows = yue2_rows();
    if let Some(path) = ar {
        let file = read(path)?;
        half(&sites(&file, ar_strength)?, "text_encoders.model.layers", &rows, &mut tensors)?;
    }
    if let Some(path) = nar {
        let file = read(path)?;
        half(&sites(&file, nar_strength)?, "diffusion_model.model.layers", &rows, &mut tensors)?;
    }
    if tensors.is_empty() {
        bail!("the adapter has no tensors ComfyUI's YuE2 can take");
    }
    let mut metadata = BTreeMap::new();
    metadata.insert("format".to_string(), "pt".to_string());
    metadata.insert("base_model".to_string(), "YuE2-3B (ComfyUI native)".to_string());
    metadata.insert("name".to_string(), name.to_string());
    metadata.insert("layout".to_string(), "planner under text_encoders, sound under diffusion_model; qkv_proj and gate_up_proj are exact block-diagonal fusions of the separate q, k, v and gate, up adapters, strength folded in".to_string());
    if let Some(trigger) = trigger.filter(|trigger| !trigger.trim().is_empty()) {
        metadata.insert("modelspec.trigger_phrase".to_string(), trigger.to_string());
    }
    let count = tensors.len();
    write(out, &tensors, &metadata)?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tensor(shape: &[usize], seed: u32) -> Tensor {
        let size: usize = shape.iter().product();
        let data = (0..size).map(|index| (((index as u32).wrapping_mul(2654435761).wrapping_add(seed)) % 1000) as f32 / 1000.0 - 0.5).collect();
        Tensor { shape: shape.to_vec(), data }
    }

    fn matmul(a: &Tensor, b: &Tensor) -> Vec<f32> {
        let (n, k, m) = (a.rows(), a.cols(), b.cols());
        let mut out = vec![0.0; n * m];
        for i in 0..n {
            for p in 0..k {
                let x = a.at(i, p);
                for j in 0..m {
                    out[i * m + j] += x * b.at(p, j);
                }
            }
        }
        out
    }

    #[test]
    fn a_lokr_written_as_lora_has_the_same_delta() {
        let (w1, a, b) = (tensor(&[2, 4], 1), tensor(&[6, 3], 2), tensor(&[3, 5], 3));
        let site = Site::Lokr { w1: w1.clone(), a: a.clone(), b: b.clone(), scale: 1.5, alpha: None };
        let (up, down) = site.as_lora();
        let product = matmul(&up, &down);
        let w2 = Tensor { shape: vec![6, 5], data: matmul(&a, &b) };
        for i in 0..2 {
            for j in 0..4 {
                for r in 0..6 {
                    for c in 0..5 {
                        let expected = 1.5 * w1.at(i, j) * w2.at(r, c);
                        let got = product[(i * 6 + r) * 20 + j * 5 + c];
                        assert!((expected - got).abs() < 1e-5, "{expected} {got}");
                    }
                }
            }
        }
    }

    #[test]
    fn a_fused_module_keeps_each_part_its_own_rows() {
        let q = Site::Lora { up: tensor(&[4, 2], 4), down: tensor(&[2, 3], 5), scale: 1.0 };
        let v = Site::Lora { up: tensor(&[2, 1], 6), down: tensor(&[1, 3], 7), scale: 2.0 };
        let (up, down) = fuse(&[(Some(&q), 4), (None, 2), (Some(&v), 2)], 3).unwrap();
        let product = matmul(&up, &down);
        let (q_up, q_down) = q.as_lora();
        let q_delta = matmul(&q_up, &q_down);
        assert_eq!(&product[..12], &q_delta[..]);
        assert!(product[12..18].iter().all(|value| *value == 0.0));
        let (v_up, v_down) = v.as_lora();
        assert_eq!(&product[18..], &matmul(&v_up, &v_down)[..]);
    }

    #[test]
    fn bfloat16_rounds_to_nearest_even() {
        assert_eq!(f32_to_bf16(1.0), 0x3f80);
        assert_eq!(f32::from_bits((f32_to_bf16(0.1) as u32) << 16), 0.100097656);
    }
}

#[cfg(test)]
mod real {
    /// Converts a trained adapter from the environment, for checking it
    /// against its source: YUE2_EXPORT_FROM (a folder with native-ar and
    /// native-nar) into YUE2_EXPORT_TO.
    #[test]
    #[ignore]
    fn exports_a_trained_adapter() {
        let from = std::path::PathBuf::from(std::env::var("YUE2_EXPORT_FROM").unwrap());
        let to = std::path::PathBuf::from(std::env::var("YUE2_EXPORT_TO").unwrap());
        let count = super::export_yue2(Some(&from.join("native-ar.safetensors")), Some(&from.join("native-nar.safetensors")), 1.0, 1.0, &to, &std::env::var("YUE2_EXPORT_NAME").unwrap_or_default(), std::env::var("YUE2_EXPORT_TRIGGER").ok().as_deref()).unwrap();
        assert!(count > 0);
    }
}
