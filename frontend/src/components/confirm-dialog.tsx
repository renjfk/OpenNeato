interface ConfirmDialogProps {
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmDialog({ message, confirmLabel = "Delete", onConfirm, onCancel }: ConfirmDialogProps) {
    return (
        // biome-ignore lint/a11y/useKeyWithClickEvents: overlay dismiss is supplementary to Cancel button
        <div class="confirm-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only, not interactive */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: dialog container */}
            <div class="confirm-dialog" onClick={(e) => e.stopPropagation()}>
                <div class="confirm-message">{message}</div>
                <div class="confirm-actions">
                    <button type="button" class="confirm-btn cancel" onClick={onCancel}>
                        Cancel
                    </button>
                    <button type="button" class="confirm-btn destructive" onClick={onConfirm}>
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
