interface NotificationItemProps {
  title: string;
  body: string;
  timestamp: string;
  read?: boolean;
  onMarkRead?: () => void;
}

export function NotificationItem({ title, body, timestamp, read = false, onMarkRead }: NotificationItemProps) {
  return (
    <div className={`flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors ${read ? "" : "bg-blue-50 dark:bg-blue-950"}`}>
      {!read && (
        <span aria-hidden="true" className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">{title}</p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400 line-clamp-2">{body}</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">{timestamp}</p>
      </div>
      {!read && onMarkRead && (
        <button
          type="button"
          onClick={onMarkRead}
          aria-label={`Mark "${title}" as read`}
          className="flex-shrink-0 text-xs text-blue-600 dark:text-blue-400 hover:underline focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
        >
          Mark read
        </button>
      )}
    </div>
  );
}
