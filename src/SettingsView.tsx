import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import ChecklistIcon from "@mui/icons-material/Checklist";
import HubIcon from "@mui/icons-material/Hub";
import PersonAddAlt1Icon from "@mui/icons-material/PersonAddAlt1";

import {
  AccountUser,
  changeOwnPassword,
  createAccountUser,
  listAccountUsers,
  resetAccountPassword,
  setAccountDisabled,
} from "./app/accounts";
import { FeatureFlagName, FeatureFlags, useFeatures } from "./app/features";
import { NotifyFn } from "./app/notify";
import { strings } from "./app/strings";
import { errorMessage } from "./app/utils";

const SWITCHES: Array<{
  key: FeatureFlagName;
  label: string;
  hint: string;
}> = [
  { key: "webdav", label: "flagWebdav", hint: "flagWebdavHint" },
  { key: "mcp", label: "flagMcp", hint: "flagMcpHint" },
  { key: "apiKey", label: "flagApiKey", hint: "flagApiKeyHint" },
  { key: "sites", label: "flagSites", hint: "flagSitesHint" },
  { key: "imageHost", label: "flagImageHost", hint: "flagImageHostHint" },
];

const cardSx = {
  px: 1.5,
  py: 1.25,
  borderRadius: 2,
  border: "1px solid",
  borderColor: "divider",
  backgroundColor: "background.paper",
} as const;

function SettingsView({
  onNotify,
  onOpenSetup,
  onOpenMcp,
}: {
  onNotify: NotifyFn;
  onOpenSetup?: () => void;
  onOpenMcp?: () => void;
}) {
  const { flags, sitesHost, config, updateFlags } = useFeatures();
  const [pending, setPending] = useState<FeatureFlagName | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetValue, setResetValue] = useState("");

  useEffect(() => {
    if (!config?.admin) return;
    listAccountUsers().then(setUsers).catch((error) => onNotify(errorMessage(error), "error"));
  }, [config?.admin, onNotify]);

  const savePassword = async () => {
    if (newPassword !== confirmPassword) {
      onNotify(strings.passwordMismatch, "error");
      return;
    }
    setSavingPassword(true);
    try {
      await changeOwnPassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onNotify(strings.passwordChanged, "success");
    } catch (error) {
      onNotify(errorMessage(error) || strings.passwordChangeFailed, "error");
    } finally {
      setSavingPassword(false);
    }
  };

  const createUser = async () => {
    setCreatingUser(true);
    try {
      await createAccountUser(newUsername, newUserPassword);
      setNewUsername("");
      setNewUserPassword("");
      setUsers(await listAccountUsers());
      onNotify(strings.accountCreated, "success");
    } catch (error) {
      onNotify(errorMessage(error) || strings.createUserFailed, "error");
    } finally {
      setCreatingUser(false);
    }
  };

  const resetPassword = async (username: string) => {
    try {
      await resetAccountPassword(username, resetValue);
      setResetting(null);
      setResetValue("");
      onNotify(strings.passwordReset, "success");
    } catch (error) {
      onNotify(errorMessage(error) || strings.resetPasswordFailed, "error");
    }
  };

  const toggleDisabled = async (user: AccountUser) => {
    try {
      await setAccountDisabled(user.username, !user.disabled);
      setUsers(await listAccountUsers());
      onNotify(strings.accountUpdated, "success");
    } catch (error) {
      onNotify(errorMessage(error) || strings.updateUserFailed, "error");
    }
  };

  const toggle = async (key: FeatureFlagName, value: boolean) => {
    setPending(key);
    try {
      await updateFlags({ [key]: value } as Partial<FeatureFlags>);
      onNotify(strings.flagSaved, "success");
    } catch (error) {
      onNotify(errorMessage(error) || strings.flagSaveFailed, "error");
    } finally {
      setPending(null);
    }
  };

  return (
    <Box sx={{ px: 2, py: 2, maxWidth: 640, minHeight: 0 }}>
      <Typography variant="h6" sx={{ mb: 0.5 }}>
        {strings.settingsTitle}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {strings.settingsHint}
      </Typography>
      {(onOpenSetup || onOpenMcp) && (
        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap" }}>
          {onOpenSetup && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<ChecklistIcon />}
              onClick={onOpenSetup}
            >
              {strings.setupOpenFromSettings}
            </Button>
          )}
          {onOpenMcp && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<HubIcon />}
              onClick={onOpenMcp}
            >
              {strings.mcpPlayOpenFromSettings}
            </Button>
          )}
        </Stack>
      )}
      <Alert severity="info" sx={{ mb: 2 }}>
        {strings.mcpRequiresApiKey}
      </Alert>
      {!sitesHost && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {strings.imagesHostMissing}
          </Typography>
          <Typography variant="body2">{strings.imagesHostMissingHint}</Typography>
        </Alert>
      )}
      <Typography variant="subtitle1" sx={{ mb: 1 }}>{strings.changePasswordTitle}</Typography>
      <Stack spacing={1.5} sx={{ mb: 3 }}>
        <TextField label={strings.currentPassword} type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        <TextField label={strings.newPassword} type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} helperText={strings.passwordMinLengthHint} />
        <TextField label={strings.confirmPassword} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        <Button variant="contained" disabled={savingPassword} onClick={() => void savePassword()}>
          {strings.savePassword}
        </Button>
      </Stack>
      {config?.admin && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1">{strings.accountsTitle}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {strings.accountsHint}
          </Typography>

          <Box sx={{ ...cardSx, mb: 1.5 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25 }}>
              <PersonAddAlt1Icon fontSize="small" color="action" />
              <Typography sx={{ fontWeight: 700 }}>{strings.createAccountSection}</Typography>
            </Stack>
            <Stack spacing={1.25}>
              <TextField
                size="small"
                label={strings.accountUsername}
                value={newUsername}
                onChange={(event) => setNewUsername(event.target.value)}
                helperText={strings.accountUsernameHint}
                fullWidth
              />
              <TextField
                size="small"
                label={strings.newPassword}
                type="password"
                value={newUserPassword}
                onChange={(event) => setNewUserPassword(event.target.value)}
                helperText={strings.passwordMinLengthHint}
                fullWidth
              />
              <Button
                variant="contained"
                disabled={creatingUser || !newUsername.trim() || !newUserPassword}
                onClick={() => void createUser()}
                sx={{ alignSelf: { xs: "stretch", sm: "flex-start" } }}
              >
                {strings.createAccount}
              </Button>
            </Stack>
          </Box>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontWeight: 600 }}>
            {strings.accountListSection}
          </Typography>
          <Stack spacing={1}>
            {users.length === 0 ? (
              <Box sx={cardSx}>
                <Typography variant="body2" color="text.secondary">
                  {strings.noAccountsYet}
                </Typography>
              </Box>
            ) : (
              users.map((user) => (
                <Box key={user.username} sx={cardSx}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1}
                    alignItems={{ xs: "stretch", sm: "center" }}
                    justifyContent="space-between"
                  >
                    <Stack spacing={0.75} sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 700, wordBreak: "break-all" }}>
                        {user.username}
                      </Typography>
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        <Chip
                          size="small"
                          label={user.role === "admin" ? strings.accountRoleAdmin : strings.accountRoleUser}
                          color={user.role === "admin" ? "primary" : "default"}
                          variant={user.role === "admin" ? "filled" : "outlined"}
                        />
                        {user.disabled && (
                          <Chip size="small" label={strings.accountDisabled} color="warning" />
                        )}
                      </Stack>
                    </Stack>
                    {user.role !== "admin" && (
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => {
                            setResetting((current) =>
                              current === user.username ? null : user.username
                            );
                            setResetValue("");
                          }}
                        >
                          {strings.resetPassword}
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color={user.disabled ? "success" : "warning"}
                          onClick={() => void toggleDisabled(user)}
                        >
                          {user.disabled ? strings.enableAccount : strings.disableAccount}
                        </Button>
                      </Stack>
                    )}
                  </Stack>
                  {resetting === user.username && (
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1}
                      alignItems={{ sm: "flex-start" }}
                      sx={{ mt: 1.25, pt: 1.25, borderTop: "1px solid", borderColor: "divider" }}
                    >
                      <TextField
                        size="small"
                        type="password"
                        label={strings.newPassword}
                        value={resetValue}
                        onChange={(event) => setResetValue(event.target.value)}
                        helperText={strings.passwordMinLengthHint}
                        fullWidth
                        sx={{ flex: 1 }}
                      />
                      <Button
                        size="small"
                        variant="contained"
                        disabled={!resetValue}
                        onClick={() => void resetPassword(user.username)}
                        sx={{ mt: { sm: 0.5 } }}
                      >
                        {strings.savePassword}
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          setResetting(null);
                          setResetValue("");
                        }}
                        sx={{ mt: { sm: 0.5 } }}
                      >
                        {strings.cancelResetPassword}
                      </Button>
                    </Stack>
                  )}
                </Box>
              ))
            )}
          </Stack>
        </Box>
      )}
      <Stack spacing={1.5}>
        {SWITCHES.map((item) => (
          <Box key={item.key} sx={cardSx}>
            <FormControlLabel
              sx={{ alignItems: "flex-start", ml: 0, mr: 0, width: "100%" }}
              control={
                pending === item.key ? (
                  <CircularProgress size={22} sx={{ mx: 1.25, mt: 0.75 }} />
                ) : (
                  <Switch
                    checked={flags[item.key]}
                    onChange={(event) => toggle(item.key, event.target.checked)}
                    slotProps={{ input: { "aria-label": strings[item.label] } }}
                  />
                )
              }
              label={
                <Box sx={{ py: 0.5 }}>
                  <Typography sx={{ fontWeight: 700 }}>{strings[item.label]}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {strings[item.hint]}
                  </Typography>
                </Box>
              }
            />
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

export default SettingsView;
