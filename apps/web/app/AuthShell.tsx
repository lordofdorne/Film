import { Logo } from "../src/ui/index.js";

/**
 * The frame every account screen shares: one centred column, the mark, a
 * title, and nothing competing with the one form on it. Sign in, choosing a
 * password, the account page and saving a film all look like the same place,
 * because to the person using them they are.
 */
export const AuthShell = ({
  title,
  lede,
  children,
}: {
  readonly title: string;
  readonly lede?: React.ReactNode;
  readonly children: React.ReactNode;
}) => (
  <main className="auth">
    <div className="auth__card">
      <Logo size={40} />
      <h1 className="title auth__title">{title}</h1>
      {lede !== undefined && <p className="lede">{lede}</p>}
      <div className="auth__body">{children}</div>
    </div>
  </main>
);
