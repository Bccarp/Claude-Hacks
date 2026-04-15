import { useState } from "react";

const MAX_LEN = 280;

interface Props {
  disabled?: boolean;
  onSubmit: (payload: { type: "question" | "note"; text: string }) => void;
}

export default function Composer({ disabled, onSubmit }: Props) {
  const [type, setType] = useState<"question" | "note">("note");
  const [text, setText] = useState("");

  const trimmed = text.trim();
  const canSend = !disabled && trimmed.length > 0 && trimmed.length <= MAX_LEN;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    onSubmit({ type, text: trimmed });
    setText("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-slate-800 rounded-xl p-4 sticky bottom-0"
    >
      <div className="flex gap-2 mb-3">
        <TypePill
          active={type === "note"}
          onClick={() => setType("note")}
          label="Note"
        />
        <TypePill
          active={type === "question"}
          onClick={() => setType("question")}
          label="Question"
        />
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
        disabled={disabled}
        placeholder={
          type === "question"
            ? "Ask something to the room…"
            : "Drop a note for the room…"
        }
        rows={3}
        className="w-full rounded-lg bg-slate-700 px-3 py-2 outline-none focus:ring-2 focus:ring-sky-400 resize-none disabled:opacity-50"
      />
      <div className="flex items-center justify-between mt-2">
        <span
          className={`text-xs ${
            text.length > MAX_LEN - 20 ? "text-amber-300" : "text-slate-400"
          }`}
        >
          {text.length}/{MAX_LEN}
        </span>
        <button
          type="submit"
          disabled={!canSend}
          className="rounded-lg bg-sky-500 hover:bg-sky-400 disabled:bg-slate-600 px-4 py-1.5 text-sm font-semibold transition"
        >
          Post
        </button>
      </div>
    </form>
  );
}

function TypePill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-sm transition ${
        active
          ? "bg-sky-500 text-white"
          : "bg-slate-700 text-slate-300 hover:bg-slate-600"
      }`}
    >
      {label}
    </button>
  );
}
