import { api } from "@convex-research-assistant/backend/convex/_generated/api";
import { Button } from "@convex-research-assistant/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@convex-research-assistant/ui/components/dropdown-menu";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export default function UserMenu() {
  const user = useQuery(api.auth.getCurrentUser);
  const removeOwnedBatch = useMutation(api.sessions.removeOwnedBatch);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>{user?.name}</DropdownMenuTrigger>
      <DropdownMenuContent className="bg-card">
        <DropdownMenuGroup>
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>{user?.email}</DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    location.reload();
                  },
                },
              });
            }}
          >
            Sign Out
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={async () => {
              if (
                !user?.email ||
                !window.confirm("Permanently delete your account and all conversations?")
              )
                return;
              const password = window.prompt("Confirm your password to delete the account");
              if (!password) return;
              try {
                const verified = await authClient.signIn.email({ email: user.email, password });
                if (verified.error) throw new Error(verified.error.message);
                while (await removeOwnedBatch({})) {
                  /* Each mutation deletes a bounded batch. */
                }
                const result = await authClient.deleteUser({ password });
                if (result.error) throw new Error(result.error.message);
                location.reload();
              } catch (error) {
                toast.error(String(error));
              }
            }}
          >
            Delete Account
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
