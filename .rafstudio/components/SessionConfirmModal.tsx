import React, { useEffect, useState } from 'react';
import { Bot, Check, FolderOpen, ShieldCheck, X } from 'lucide-react';
import { useI18n } from '../context/I18nContext';
import type { WorkspaceSession } from './SessionList';

interface SessionConfirmModalProps {
    /** What an agent is asking to do, and in which session. */
    request: { sessionName: string; title?: string } | null;
    /** Every session, for the "choose another one" branch. */
    sessions: WorkspaceSession[];
    activeSessionId: string | null;
    /** Allow this one request. */
    onAllowOnce: () => void;
    /** Stop asking inside the open session. */
    onAllowAlways: () => void;
    /** Make another session current and allow the request there. */
    onPickOther: (sessionId: string) => void;
    onDecline: () => void;
}

/**
 * The agent's request arrives as a modal, because creating a track spends real
 * time and belongs in one particular session. The answer is remembered: "once"
 * covers this request, "always" covers the rest of the open session, and
 * "another session" switches the target before anything is made.
 */
export const SessionConfirmModal: React.FC<SessionConfirmModalProps> = ({
    request,
    sessions,
    activeSessionId,
    onAllowOnce,
    onAllowAlways,
    onPickOther,
    onDecline,
}) => {
    const { t } = useI18n();
    const [choosing, setChoosing] = useState(false);

    useEffect(() => {
        if (!request) {
            setChoosing(false);
            return;
        }
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onDecline(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [request, onDecline]);

    if (!request) return null;

    const others = sessions.filter((session) => session.id !== activeSessionId);

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div
                className="w-full max-w-md mx-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-zinc-900"
                data-slot="session-confirm-modal"
            >
                <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500/10">
                        <Bot size={20} className="text-blue-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-base font-semibold text-zinc-900 dark:text-white">
                            {t('sessionConfirmTitle')}
                        </h3>
                        <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                            {t('sessionConfirmBody').replace('{session}', request.sessionName)}
                        </p>
                        {request.title && (
                            <p className="mt-2 truncate rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-white/5 dark:text-zinc-300">
                                {request.title}
                            </p>
                        )}
                    </div>
                </div>

                {choosing ? (
                    <div className="mt-5">
                        <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            {t('sessionConfirmPick')}
                        </p>
                        <div className="max-h-56 space-y-1 overflow-y-auto">
                            {others.length === 0 && (
                                <p className="py-2 text-sm text-zinc-500 dark:text-zinc-400">
                                    {t('sessionNoMatch')}
                                </p>
                            )}
                            {others.map((session) => (
                                <button
                                    key={session.id}
                                    type="button"
                                    onClick={() => onPickOther(session.id)}
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-800 transition-colors hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-white/10"
                                >
                                    <FolderOpen size={15} className="shrink-0 text-zinc-400" />
                                    <span className="min-w-0 truncate">{session.name}</span>
                                    <span className="ml-auto shrink-0 text-[10px] uppercase text-zinc-400">
                                        {session.closedAt !== null
                                            ? t('sessionClosedState')
                                            : t('sessionOpenState')}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => setChoosing(false)}
                            className="mt-4 w-full rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        >
                            {t('cancel')}
                        </button>
                    </div>
                ) : (
                    <div className="mt-6 flex flex-col gap-2">
                        <button
                            type="button"
                            onClick={onAllowOnce}
                            className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                        >
                            <Check size={16} />
                            {t('sessionConfirmOnce')}
                        </button>
                        <button
                            type="button"
                            onClick={onAllowAlways}
                            className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
                        >
                            <ShieldCheck size={16} />
                            {t('sessionConfirmAlways')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setChoosing(true)}
                            className="flex items-center justify-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        >
                            <FolderOpen size={16} />
                            {t('sessionConfirmOther')}
                        </button>
                        <button
                            type="button"
                            onClick={onDecline}
                            className="flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-rose-600 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-rose-400"
                        >
                            <X size={16} />
                            {t('sessionConfirmDecline')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
