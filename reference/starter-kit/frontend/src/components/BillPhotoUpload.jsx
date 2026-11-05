import { useRef, useState } from "react";

// Required photo picker used on GRN and Expense creation. Shows a thumbnail
// preview once a file is chosen. The actual upload happens server-side when
// the form is submitted — this component just holds the selected File object
// for the parent to send along with the rest of the form.
//
// Deliberately NO `capture` attribute on the file input: that attribute forces
// the device straight into the camera app, skipping the native OS chooser that
// normally offers both "Take Photo" and "Choose from Library/Gallery." Leaving
// it off lets the browser show its normal picker with both options.
export default function BillPhotoUpload({ file, onChange }) {
  const [preview, setPreview] = useState(null);
  const inputRef = useRef(null);

  function handleSelect(e) {
    const selected = e.target.files[0];
    if (!selected) return;
    onChange(selected);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result);
    reader.readAsDataURL(selected);
  }

  function clear() {
    onChange(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      <label className="block text-xs text-text-muted mb-1">
        Bill / receipt photo <span className="text-red">*required</span>
      </label>
      <div className="flex items-center gap-3">
        {preview ? (
          <img src={preview} alt="Bill preview" className="w-16 h-16 object-cover rounded border border-border" />
        ) : (
          <div className="w-16 h-16 rounded border border-dashed border-border flex items-center justify-center text-xs text-text-muted">
            None
          </div>
        )}
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            onChange={handleSelect}
            className="text-xs text-text-muted file:mr-3 file:px-4 file:py-2 file:rounded-full file:border file:border-border file:bg-surface-2 file:text-text file:text-xs file:cursor-pointer"
          />
          {file && (
            <button type="button" onClick={clear} className="block text-xs text-red hover:underline mt-1">
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
