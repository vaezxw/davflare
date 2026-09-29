import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

import {
  AccountProfile,
  listAccountProfiles,
} from "./app/accountProfiles";
import { NotifyFn } from "./app/notify";
import { Route } from "./app/route";
import { strings } from "./app/strings";
import { errorMessage, formatListingSize } from "./app/utils";
import UserAvatar from "./UserAvatar";

function AccountsView({
  navigate,
  onNotify,
}: {
  navigate: (route: Route) => void;
  onNotify: NotifyFn;
}) {
  const [accounts, setAccounts] = useState<AccountProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const list = await listAccountProfiles();
        if (active) setAccounts(list);
      } catch (error) {
        if (active) onNotify(errorMessage(error), "error");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [onNotify]);

  const openAccount = (username: string) => {
    navigate({ kind: "account", username });
  };

  return (
    <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 2, maxWidth: 1100, mx: "auto" }}>
      <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>
        {strings.accountsTitle}
      </Typography>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress size={28} />
        </Box>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{/* avatar */}</TableCell>
              <TableCell>{strings.accountUsername}</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">{strings.accountFiles}</TableCell>
              <TableCell align="right">{strings.accountTotalSize}</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {accounts.map((account) => (
              <TableRow
                key={account.username}
                hover
                sx={{ cursor: "pointer" }}
                onClick={() => openAccount(account.username)}
              >
                <TableCell sx={{ width: 56 }}>
                  <UserAvatar
                    username={account.username}
                    avatar={account.avatar}
                    avatarUrl={account.avatarUrl}
                    size={36}
                  />
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontWeight: 600 }}>{account.username}</Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={
                      account.role === "admin"
                        ? strings.accountRoleAdmin
                        : strings.accountRoleUser
                    }
                    color={account.role === "admin" ? "primary" : "default"}
                    variant={account.role === "admin" ? "filled" : "outlined"}
                  />
                </TableCell>
                <TableCell>
                  {account.disabled ? (
                    <Chip size="small" label={strings.accountDisabled} color="warning" />
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell align="right">{account.stats.fileCount}</TableCell>
                <TableCell align="right">
                  <Stack alignItems="flex-end" spacing={0.25}>
                    <span>{formatListingSize(account.stats.totalBytes)}</span>
                    {account.stats.truncated && (
                      <Typography variant="caption" color="warning.main">
                        {strings.statsTruncated}
                      </Typography>
                    )}
                  </Stack>
                </TableCell>
                <TableCell align="right" onClick={(event) => event.stopPropagation()}>
                  <Button
                    size="small"
                    onClick={() => openAccount(account.username)}
                  >
                    {strings.viewAccount}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
}

export default AccountsView;
