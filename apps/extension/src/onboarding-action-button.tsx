import * as React from "react";

type Props = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  onClick(): void | Promise<void>;
};

export function OnboardingActionButton({
  onClick,
  children,
  disabled,
  ...props
}: Props) {
  const pendingRef = React.useRef(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState(false);
  return (
    <>
      <button
        {...props}
        disabled={disabled || pending}
        aria-busy={pending}
        onClick={async () => {
          if (pendingRef.current) return;
          pendingRef.current = true;
          setPending(true);
          setError(false);
          try {
            await onClick();
          } catch {
            setError(true);
          } finally {
            pendingRef.current = false;
            setPending(false);
          }
        }}
      >
        {pending && <i className="button-spinner" aria-hidden="true" />}
        {children}
      </button>
      {error && (
        <span role="alert">The action did not finish. Please try again.</span>
      )}
    </>
  );
}
