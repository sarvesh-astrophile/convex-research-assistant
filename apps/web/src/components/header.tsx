import { Link } from "@tanstack/react-router";
import { FlaskConical } from "lucide-react";

export default function Header() {
  const links = [
    { to: "/", label: "Home" },
    { to: "/dashboard", label: "Dashboard" },
  ] as const;

  return (
    <header className="border-b bg-background">
      <div className="flex h-11 flex-row items-center justify-between px-3 md:px-4">
        <Link
          to="/"
          className="flex items-center gap-2 text-xs font-semibold tracking-wide uppercase"
        >
          <FlaskConical className="size-4" />
          Convex Research
        </Link>
        <nav className="flex items-center gap-3 text-xs text-muted-foreground">
          {links.map(({ to, label }) => {
            return (
              <Link
                key={to}
                to={to}
                className="transition-colors hover:text-foreground"
                activeProps={{ className: "text-foreground" }}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
