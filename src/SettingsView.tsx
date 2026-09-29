import { useState } from "react";
import {
  Alert,
  Box,
  Button,
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
import AccountCircleIcon from "@mui/icons-material/AccountCircle";

import {
  changeOwnPassword,
  createAccountUser,
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
  onOpenAccounts,
}: {
  onNotify: NotifyFn;
  onOpenSetup?: () => void;
  onOpenMcp?: () => void;
  onOpenAccounts?: () => void;
}) {
  const { flags, sitesHost, config, updateFlags } = useFeatures();
  const [pending, setPending] = useState<FeatureFlagName | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);

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
      onNotify(strings.accountCreated, "success");
    } catch (error) {
      onNotify(errorMessage(error) || strings.createUserFailed, "error");
    } finally {
      setCreatingUser(false);
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

          {onOpenAccounts && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<AccountCircleIcon />}
              onClick={onOpenAccounts}
              sx={{ mb: 1.5 }}
            >
              {strings.openAccounts}
            </Button>
          )}

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
