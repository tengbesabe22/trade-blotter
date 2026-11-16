type LiveConnectionStatusProps = {
  connected: boolean;
  message: string;
};

export function LiveConnectionStatus({ connected, message }: LiveConnectionStatusProps) {
  return (
    <span className="inline-flex items-center gap-2">
      {connected && (
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-red-500 motion-safe:animate-pulse" />
      )}
      {message}
    </span>
  );
}
