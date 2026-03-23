const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE_MB = 2;
const TARGET_MAX_DIMENSION = 400;
const COMPRESSION_QUALITY = 0.7;

export function validateImageFile(
  file: File
): { valid: boolean; error?: string } {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: "Only JPEG, PNG, and WebP images are allowed" };
  }
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return { valid: false, error: `Image must be smaller than ${MAX_FILE_SIZE_MB}MB` };
  }
  return { valid: true };
}

export function compressAndConvertToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;

        if (width > TARGET_MAX_DIMENSION || height > TARGET_MAX_DIMENSION) {
          if (width > height) {
            height = Math.round((height * TARGET_MAX_DIMENSION) / width);
            width = TARGET_MAX_DIMENSION;
          } else {
            width = Math.round((width * TARGET_MAX_DIMENSION) / height);
            height = TARGET_MAX_DIMENSION;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to get canvas context"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const base64 = canvas.toDataURL("image/jpeg", COMPRESSION_QUALITY);
        resolve(base64);
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
