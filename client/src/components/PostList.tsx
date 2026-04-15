import { useState } from "react";
import ReactionBar from "./ReactionBar";
import type { PublicPost, ReactionEmoji } from "../lib/socket";

interface Props {
  posts: PublicPost[];
  disabled?: boolean;
  onReact: (postId: string, emoji: ReactionEmoji) => void;
  onFlag: (postId: string) => void;
}

export default function PostList({ posts, disabled, onReact, onFlag }: Props) {
  if (posts.length === 0) {
    return (
      <div className="text-slate-500 text-center py-12">
        Nothing yet. Be the first to post something.
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {posts.map((p) => (
        <PostRow
          key={p.postId}
          post={p}
          disabled={disabled}
          onReact={(e) => onReact(p.postId, e)}
          onFlag={() => onFlag(p.postId)}
        />
      ))}
    </ul>
  );
}

function PostRow({
  post,
  disabled,
  onReact,
  onFlag,
}: {
  post: PublicPost;
  disabled?: boolean;
  onReact: (emoji: ReactionEmoji) => void;
  onFlag: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <li className="bg-slate-800 rounded-xl p-4 relative">
      <div className="flex items-start justify-between">
        <span
          className={`text-xs uppercase tracking-wide px-2 py-0.5 rounded-full ${
            post.type === "question"
              ? "bg-sky-900/60 text-sky-200"
              : "bg-emerald-900/60 text-emerald-200"
          }`}
        >
          {post.type}
        </span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="text-slate-400 hover:text-slate-200 px-2"
            aria-label="More options"
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 bg-slate-700 rounded-lg shadow-lg z-10 text-sm overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  onFlag();
                  setMenuOpen(false);
                }}
                className="block px-4 py-2 hover:bg-slate-600 w-full text-left text-rose-200"
              >
                Flag as inappropriate
              </button>
            </div>
          )}
        </div>
      </div>
      <p className="mt-2 text-slate-100 whitespace-pre-wrap break-words">
        {post.text}
      </p>
      <ReactionBar
        reactions={post.reactions}
        onReact={onReact}
        disabled={disabled}
      />
    </li>
  );
}
