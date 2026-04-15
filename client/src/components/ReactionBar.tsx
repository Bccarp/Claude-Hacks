import { REACTION_EMOJIS, type ReactionEmoji } from "../lib/socket";

interface Props {
  reactions: Record<string, number>;
  onReact: (emoji: ReactionEmoji) => void;
  disabled?: boolean;
}

export default function ReactionBar({ reactions, onReact, disabled }: Props) {
  return (
    <div className="flex gap-2 mt-3">
      {REACTION_EMOJIS.map((emoji) => {
        const count = reactions[emoji] ?? 0;
        return (
          <button
            key={emoji}
            type="button"
            disabled={disabled}
            onClick={() => onReact(emoji)}
            className="px-2 py-1 rounded-full bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-sm flex items-center gap-1 transition"
          >
            <span>{emoji}</span>
            {count > 0 && (
              <span className="text-slate-300 text-xs">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
