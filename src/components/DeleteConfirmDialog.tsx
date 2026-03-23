interface DeleteConfirmDialogProps {
  employeeName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isOpen: boolean;
}

export function DeleteConfirmDialog({
  employeeName,
  onConfirm,
  onCancel,
  isOpen,
}: DeleteConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Confirm Delete</h3>
        <p className="modal-text">
          Are you sure you want to delete employee &quot;{employeeName}&quot;?
        </p>
        <p className="modal-warning">This action cannot be undone.</p>
        <div className="modal-actions">
          <button className="btn btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
