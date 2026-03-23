import { useRef, useState } from "react";
import { validateImageFile, compressAndConvertToBase64 } from "../utils/image";

interface ImageUploadProps {
  currentImage: string | null;
  onImageChange: (base64: string | null) => void;
}

export function ImageUpload({ currentImage, onImageChange }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setError(validation.error || "Invalid file");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setLoading(true);
    try {
      const base64 = await compressAndConvertToBase64(file);
      onImageChange(base64);
    } catch {
      setError("Failed to process image");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = () => {
    onImageChange(null);
    setError(null);
  };

  return (
    <div className="image-upload">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileSelect}
        className="image-upload-input"
      />

      {currentImage ? (
        <div className="image-preview">
          <img src={currentImage} alt="Employee photo" className="image-preview-img" />
          <div className="image-preview-actions">
            <button
              type="button"
              className="btn btn-small"
              onClick={() => inputRef.current?.click()}
            >
              Change
            </button>
            <button
              type="button"
              className="btn btn-small btn-danger"
              onClick={handleRemove}
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="image-upload-zone"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
        >
          {loading ? "Processing..." : "Click to upload photo"}
        </button>
      )}

      {error && <p className="image-upload-error">{error}</p>}
    </div>
  );
}
