import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  LinearProgress,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment,
  Paper,
  Button,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import PauseIcon from "@mui/icons-material/Pause";
import ReplayIcon from "@mui/icons-material/Replay";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SearchIcon from "@mui/icons-material/Search";
import PeopleAltIcon from "@mui/icons-material/PeopleAlt";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
} from "recharts";
import ConfirmDialog from "../components/ConfirmDialog";
import { Spark } from "../components/ui";
import {
  pauseAccount,
  resumeAccount,
  removeAccount,
  requestStop,
} from "../utils/api";
import { useState } from "react";

const rateColor = (r) =>
  r >= 95 ? "#10B981" : r >= 85 ? "#F59E0B" : "#EF4444";

const phaseMap = {
  fetching: { label: "Fetching", color: "#00E5FF", bg: "rgba(0,229,255,0.1)" },
  processing: {
    label: "Processing",
    color: "#7C3AED",
    bg: "rgba(124,58,237,0.1)",
  },
  done: { label: "Done", color: "#10B981", bg: "rgba(16,185,129,0.1)" },
  error: { label: "Error", color: "#EF4444", bg: "rgba(239,68,68,0.1)" },
};

const PhaseChip = ({ phase }) => {
  if (!phase || phase === "idle") return null;
  const s = phaseMap[phase] || {
    label: phase,
    color: "#9CA3AF",
    bg: "rgba(255,255,255,0.05)",
  };
  return (
    <Box
      sx={{
        display: "inline-block",
        px: 1,
        py: 0.25,
        borderRadius: 1,
        bgcolor: s.bg,
        color: s.color,
        fontSize: 10,
        fontFamily: "DM Mono, monospace",
      }}>
      {s.label}
    </Box>
  );
};

const StatusChip = ({ status }) => {
  const map = {
    active: "success",
    paused: "default",
    warning: "warning",
    error: "error",
  };
  return (
    <Chip
      label={status}
      color={map[status] || "default"}
      size="small"
      sx={{ fontFamily: "DM Mono, monospace", fontSize: 10, height: 22 }}
    />
  );
};

function StatCard({ label, value, color, sub }) {
  return (
    <Card>
      <CardContent sx={{ p: "16px !important" }}>
        <Typography
          variant="caption"
          sx={{
            color: "text.secondary",
            fontFamily: "DM Mono, monospace",
            letterSpacing: "0.08em",
            display: "block",
            mb: 1,
          }}>
          {label}
        </Typography>
        <Typography
          sx={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1, mb: 0.5 }}>
          {value}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {sub}
        </Typography>
      </CardContent>
    </Card>
  );
}

/**
 * Build a unified live-status map: email → { phase, message, done, total, fromRemote, runBy }
 *
 * Sources (in priority order, last wins):
 *  1. myActivity.accounts — backend-reported statuses scoped to this user's accounts.
 *     This covers: admin running a user's account, or any cross-browser session.
 *  2. worker.accountStatuses — THIS browser's own live state. Always most accurate for
 *     accounts this session is actively running.
 *
 * For admins we additionally overlay allActivity so they see ALL sessions' details.
 */
function buildStatusMap(accountStatuses, myActivity, allActivity, isAdmin) {
  const merged = {};

  // Layer 1: for admins, pull all remote activity first (lowest priority)
  if (isAdmin) {
    for (const [, entry] of Object.entries(allActivity || {})) {
      if (!entry.running) continue;
      for (const acc of entry.accounts || []) {
        if (acc.email && acc.phase) {
          merged[acc.email] = {
            phase: acc.phase,
            message: acc.message || "",
            done: acc.done || 0,
            total: acc.total || 0,
            fromRemote: true,
            runBy: null,
          };
        }
      }
    }
  }

  // Layer 2: myActivity (backend-scoped) — covers cross-session & cross-user for owned accounts
  for (const acc of myActivity?.accounts || []) {
    if (acc.email && acc.phase) {
      const isOwnBrowser = !!accountStatuses[acc.email];
      merged[acc.email] = {
        phase: acc.phase,
        message: acc.message || "",
        done: acc.done || 0,
        total: acc.total || 0,
        fromRemote: !isOwnBrowser,
        runBy: acc.runBy || null,
      };
    }
  }

  // Layer 3: own browser state — highest priority, always accurate for local runs
  for (const [email, status] of Object.entries(accountStatuses || {})) {
    if (status?.phase) {
      merged[email] = { ...status, fromRemote: false, runBy: null };
    }
  }

  return merged;
}

export default function Dashboard({
  data,
  refetch,
  onToast,
  worker,
  allActivity = {},
  myActivity = {},
  userRole = "user",
}) {
  const [search, setSearch] = useState("");
  const [confirmEmail, setConfirmEmail] = useState(null);
  const [stopConfirmEmail, setStopConfirmEmail] = useState(null);
  const [admStopTarget, setAdmStopTarget] = useState(null); // { email, runBy }
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  if (!data)
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "60vh",
        }}>
        <Typography color="text.secondary">Loading stats...</Typography>
      </Box>
    );

  const { running, runAllMode, accountStatuses, startRun, stopOne } = worker;
  const { summary, accounts = [] } = data;
  const isAdmin = ["superadmin", "admin"].includes(userRole);

  // Unified status map — works for all roles
  const statusMap = buildStatusMap(
    accountStatuses,
    myActivity,
    allActivity,
    isAdmin,
  );

  const enriched = accounts.map((a) => ({
    ...a,
    jobStatus: statusMap[a.email] || null,
  }));

  const runningAccounts = enriched.filter(
    (a) =>
      a.jobStatus?.phase &&
      !["done", "idle", "error"].includes(a.jobStatus?.phase),
  );

  const remoteRunning = runningAccounts.filter((a) => a.jobStatus?.fromRemote);

  const chartData = Array.from({ length: 7 }, (_, i) => {
    const active = accounts.filter(
      (a) => a.status === "active" && a.stats?.trend?.length > i,
    );
    const avg = active.length
      ? active.reduce((s, a) => s + a.stats.trend[i], 0) / active.length
      : 0;
    return { label: `T-${6 - i}`, success: +avg.toFixed(1) };
  });

  // FIX: Dynamic Y-axis floor so accounts below 80% success rate are visible.
  // Previously the domain was hard-coded to [80, 100], silently clipping any
  // account with a poor rate — exactly the ones you most need to see.
  const minTrend = accounts.length
    ? Math.min(...accounts.flatMap((a) => a.stats?.trend || [100]))
    : 80;
  const yMin = Math.max(0, Math.floor(Math.min(minTrend, 80) / 10) * 10);

  const handleRunOne = (account) => {
    const liveStatus = statusMap[account.email];
    if (
      liveStatus?.phase &&
      !["done", "idle", "error"].includes(liveStatus.phase)
    ) {
      onToast(`${account.email} is already processing`, "warning");
      return;
    }
    if (!["active", "warning"].includes(account.status)) {
      onToast(`${account.email} is paused — resume it first`, "warning");
      return;
    }
    startRun([account], "individual");
    onToast(`Running ${account.email}`, "info");
  };

  const handleStopOne = (email) => setStopConfirmEmail(email);

  const confirmStop = () => {
    if (!stopConfirmEmail) return;
    stopOne(stopConfirmEmail);
    onToast(`Stop signal sent to ${stopConfirmEmail}`, "warning");
    setStopConfirmEmail(null);
  };

  const confirmAdmStop = async () => {
    if (!admStopTarget) return;
    try {
      await requestStop(admStopTarget.runBy, admStopTarget.email);
      onToast(
        `Stop signal sent to ${admStopTarget.runBy}'s session`,
        "warning",
      );
    } catch {
      onToast("Failed to send stop signal", "error");
    }
    setAdmStopTarget(null);
  };

  const handleToggle = async (account) => {
    try {
      if (["active", "warning"].includes(account.status)) {
        await pauseAccount(account.email);
        onToast(`Paused ${account.email}`);
      } else {
        await resumeAccount(account.email);
        onToast(`Resumed ${account.email}`);
      }
      refetch();
    } catch {
      onToast("Failed to update status", "error");
    }
  };

  const handleRemove = async () => {
    try {
      await removeAccount(confirmEmail);
      onToast(`${confirmEmail} disconnected`);
      refetch();
    } catch {
      onToast("Failed to disconnect", "error");
    } finally {
      setConfirmEmail(null);
    }
  };

  const filtered = enriched.filter((a) =>
    a.email.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Box>
      {/* Live running banner — visible to all users when any of their accounts are running */}
      {runningAccounts.length > 0 && (
        <Box
          sx={{
            mb: 2,
            px: 2,
            py: 1.5,
            borderRadius: 2,
            bgcolor: "rgba(124,58,237,0.07)",
            border: "1px solid rgba(124,58,237,0.22)",
          }}>
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 1,
              alignItems: "center",
            }}>
            <Typography
              sx={{
                fontSize: 11,
                color: "#A78BFA",
                fontFamily: "DM Mono, monospace",
                mr: 1,
              }}>
              {runAllMode ? "RUN ALL" : "RUNNING"}
            </Typography>
            {runningAccounts.map((a) => {
              const j = a.jobStatus || {};
              const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
              return (
                <Chip
                  key={a.email}
                  size="small"
                  label={`${a.email.split("@")[0]} · ${j.total ? `${j.done}/${j.total} (${pct}%)` : j.phase || "starting"}${j.runBy ? ` · by ${j.runBy}` : ""}`}
                  sx={{
                    bgcolor: j.fromRemote
                      ? "rgba(0,229,255,0.1)"
                      : "rgba(124,58,237,0.15)",
                    color: j.fromRemote ? "#67E8F9" : "#C4B5FD",
                    fontSize: 11,
                    fontFamily: "DM Mono, monospace",
                  }}
                />
              );
            })}
            {isAdmin && remoteRunning.length > 0 && (
              <Chip
                size="small"
                icon={
                  <PeopleAltIcon sx={{ fontSize: 12, ml: "6px !important" }} />
                }
                label={`${remoteRunning.length} from other sessions`}
                sx={{
                  fontSize: 10,
                  height: 22,
                  bgcolor: "rgba(0,229,255,0.07)",
                  color: "#67E8F9",
                  border: "1px solid rgba(0,229,255,0.15)",
                  fontFamily: "DM Mono, monospace",
                }}
              />
            )}
          </Box>
        </Box>
      )}

      {/* Stat cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}>
          <StatCard
            label="AVG SUCCESS RATE"
            value={`${summary.avgSuccessRate}%`}
            color={rateColor(summary.avgSuccessRate)}
            sub="active accounts"
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCard
            label="EMAILS PROCESSED"
            value={summary.totalEmails.toLocaleString()}
            color="#00E5FF"
            sub="all time"
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCard
            label="ACTIVE ACCOUNTS"
            value={`${summary.activeAccounts}/${summary.totalAccounts}`}
            color="#7C3AED"
            sub="of total connected"
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCard
            label="NEEDS ATTENTION"
            value={summary.warnings}
            color={summary.warnings > 0 ? "#EF4444" : "#10B981"}
            sub="warning or error"
          />
        </Grid>
      </Grid>

      {/* Chart */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              fontFamily: "DM Mono, monospace",
              letterSpacing: "0.08em",
              display: "block",
              mb: 2,
            }}>
            SUCCESS RATE TREND
          </Typography>
          {accounts.length === 0 ? (
            <Box
              sx={{
                height: 180,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
              }}>
              <Typography sx={{ fontSize: 32 }}>📭</Typography>
              <Typography color="text.secondary" variant="body2">
                No accounts connected yet
              </Typography>
            </Box>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart
                data={chartData}
                margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                <defs>
                  <linearGradient id="agrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00E5FF" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#00E5FF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: "#4B5563" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  domain={[yMin, 100]}
                  tick={{ fontSize: 9, fill: "#4B5563" }}
                  tickLine={false}
                  axisLine={false}
                />
                <RTooltip
                  contentStyle={{
                    background: "#0F1117",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  itemStyle={{ color: "#00E5FF" }}
                />
                <Area
                  type="monotone"
                  dataKey="success"
                  stroke="#00E5FF"
                  strokeWidth={2}
                  fill="url(#agrad)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Accounts table */}
      <Card>
        <CardContent>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mb: 2,
              flexWrap: "wrap",
              gap: 1,
            }}>
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                fontFamily: "DM Mono, monospace",
                letterSpacing: "0.08em",
                fontSize: 11,
              }}>
              CONNECTED ACCOUNTS
              {isAdmin && (
                <Box component="span" sx={{ ml: 1, color: "#67E8F9" }}>
                  — all users visible
                </Box>
              )}
            </Typography>
            <TextField
              size="small"
              placeholder="Filter accounts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 16, color: "text.disabled" }} />
                  </InputAdornment>
                ),
                sx: {
                  fontSize: 12,
                  fontFamily: "DM Mono, monospace",
                  bgcolor: "rgba(255,255,255,0.03)",
                },
              }}
              sx={{ width: { xs: "100%", sm: 220 } }}
            />
          </Box>

          {filtered.length === 0 ? (
            <Box sx={{ textAlign: "center", py: 5 }}>
              <Typography color="text.disabled" variant="body2">
                {accounts.length === 0
                  ? "No accounts connected."
                  : "No accounts match your filter."}
              </Typography>
            </Box>
          ) : (
            <>
              {!isMobile ? (
                <TableContainer
                  component={Paper}
                  elevation={0}
                  sx={{ bgcolor: "transparent", overflowX: "auto" }}>
                  <Table size="small" sx={{ minWidth: 640 }}>
                    <TableHead>
                      <TableRow>
                        {[
                          "Account",
                          "Owner",
                          "Rate",
                          "Emails",
                          "Beacons",
                          "Trend",
                          "Status",
                          "Actions",
                        ].map((h) => (
                          <TableCell
                            key={h}
                            sx={{
                              color: "text.disabled",
                              fontSize: 10,
                              fontFamily: "DM Mono, monospace",
                              letterSpacing: "0.08em",
                              py: 1,
                            }}>
                            {h.toUpperCase()}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filtered.map((a) => {
                        const rate = a.stats?.successRate || 0;
                        const trend = a.stats?.trend || [100];
                        const jobSt = a.jobStatus || {};

                        // isActive: this account is currently being processed by ANY session/user
                        const isActive =
                          jobSt.phase &&
                          !["done", "idle", "error"].includes(jobSt.phase);
                        // fromRemote: being run by a different browser session (not this one)
                        const fromRemote = isActive && jobSt.fromRemote;
                        // isOwnRun: this browser is the one running it
                        const isOwnRun = isActive && !fromRemote;

                        const progress = jobSt.total
                          ? Math.round((jobSt.done / jobSt.total) * 100)
                          : 0;

                        // ── Action availability rules ──
                        // STOP: enabled whenever this account is actively processing (any session)
                        //       For remote runs, stopOne() sends stop signal via backend flag (future)
                        //       For now: stop button only works for own-session runs
                        const canStop = isOwnRun && !runAllMode;
                        // RUN: only when account is idle AND no other session running it AND not run-all mode
                        const canRun =
                          !isActive &&
                          !running &&
                          ["active", "warning"].includes(a.status);
                        // PAUSE/RESUME: only when account is idle (not being processed by anyone)
                        const canPause = !isActive;
                        // DELETE: only when account is NOT actively processing by anyone
                        // This is the key fix — disabled when ANY session is running this account
                        const canDelete = !isActive;

                        return (
                          <TableRow
                            key={a.email}
                            sx={{
                              bgcolor: isActive
                                ? fromRemote
                                  ? "rgba(0,229,255,0.03)"
                                  : "rgba(124,58,237,0.04)"
                                : "transparent",
                              transition: "background 0.2s",
                              "&:hover": { bgcolor: "rgba(255,255,255,0.02)" },
                            }}>
                            {/* Account + live status */}
                            <TableCell sx={{ py: 1.5 }}>
                              <Typography
                                sx={{
                                  fontSize: 12,
                                  fontFamily: "DM Mono, monospace",
                                }}>
                                {a.email}
                              </Typography>
                              <Box
                                sx={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 0.5,
                                  mt: 0.5,
                                  flexWrap: "wrap",
                                }}>
                                <PhaseChip phase={jobSt.phase} />
                                {jobSt.runBy && (
                                  <Box
                                    sx={{
                                      px: 1,
                                      py: 0.2,
                                      borderRadius: 1,
                                      bgcolor: "rgba(0,229,255,0.08)",
                                      color: "#67E8F9",
                                      fontSize: 9,
                                      fontFamily: "DM Mono, monospace",
                                    }}>
                                    by {jobSt.runBy}
                                  </Box>
                                )}
                                {jobSt.message && (
                                  <Typography
                                    variant="caption"
                                    color="text.disabled"
                                    sx={{ fontSize: 9 }}>
                                    {jobSt.message}
                                  </Typography>
                                )}
                              </Box>
                              {isActive && jobSt.total > 0 && (
                                <Box
                                  sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 1,
                                    mt: 0.75,
                                  }}>
                                  <LinearProgress
                                    variant="determinate"
                                    value={progress}
                                    sx={{
                                      flex: 1,
                                      height: 3,
                                      borderRadius: 2,
                                      bgcolor: "rgba(255,255,255,0.06)",
                                      "& .MuiLinearProgress-bar": {
                                        bgcolor: fromRemote
                                          ? "#00E5FF"
                                          : "#7C3AED",
                                      },
                                    }}
                                  />
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      fontSize: 9,
                                      color: fromRemote ? "#00E5FF" : "#7C3AED",
                                      fontFamily: "DM Mono, monospace",
                                      flexShrink: 0,
                                    }}>
                                    {jobSt.done}/{jobSt.total}
                                  </Typography>
                                </Box>
                              )}
                            </TableCell>

                            <TableCell sx={{ py: 1.5 }}>
                              <Typography
                                sx={{
                                  fontSize: 11,
                                  color: "text.disabled",
                                  fontFamily: "DM Mono, monospace",
                                }}>
                                {a.owner || "—"}
                              </Typography>
                            </TableCell>

                            <TableCell sx={{ py: 1.5 }}>
                              <Typography
                                sx={{
                                  fontSize: 14,
                                  fontWeight: 700,
                                  color: rateColor(rate),
                                  fontFamily: "DM Mono, monospace",
                                }}>
                                {rate}%
                              </Typography>
                            </TableCell>

                            <TableCell sx={{ py: 1.5 }}>
                              <Typography
                                sx={{
                                  fontSize: 12,
                                  color: "text.secondary",
                                  fontFamily: "DM Mono, monospace",
                                }}>
                                {(
                                  a.stats?.emailsProcessed || 0
                                ).toLocaleString()}
                              </Typography>
                            </TableCell>

                            <TableCell sx={{ py: 1.5 }}>
                              <Typography
                                sx={{
                                  fontSize: 12,
                                  color: "text.secondary",
                                  fontFamily: "DM Mono, monospace",
                                }}>
                                {(a.stats?.pixelsFired || 0).toLocaleString()}
                              </Typography>
                            </TableCell>

                            <TableCell sx={{ py: 1.5 }}>
                              <Spark data={trend} color={rateColor(rate)} />
                            </TableCell>

                            <TableCell sx={{ py: 1.5 }}>
                              <StatusChip status={a.status} />
                            </TableCell>

                            {/* ── Actions ── */}
                            <TableCell sx={{ py: 1.5 }}>
                              <Box sx={{ display: "flex", gap: 0.5 }}>
                                {/* Stop (own-session run) or Run (idle) */}
                                {canStop ? (
                                  <Tooltip title="Stop after current batch">
                                    <IconButton
                                      size="small"
                                      onClick={() => handleStopOne(a.email)}
                                      sx={{
                                        color: "#EF4444",
                                        bgcolor: "rgba(239,68,68,0.12)",
                                        borderRadius: 1.5,
                                        "&:hover": {
                                          bgcolor: "rgba(239,68,68,0.22)",
                                        },
                                      }}>
                                      <StopIcon sx={{ fontSize: 14 }} />
                                    </IconButton>
                                  </Tooltip>
                                ) : isActive ? (
                                  /* Account running in another session — admin gets amber signal button, others see disabled */
                                  fromRemote && isAdmin ? (
                                    <Tooltip
                                      title={`Signal ${jobSt.runBy || "session"} to stop ${a.email}`}>
                                      <IconButton
                                        size="small"
                                        onClick={() =>
                                          setAdmStopTarget({
                                            email: a.email,
                                            runBy: jobSt.runBy || "",
                                          })
                                        }
                                        sx={{
                                          color: "#F59E0B",
                                          bgcolor: "rgba(245,158,11,0.12)",
                                          borderRadius: 1.5,
                                          "&:hover": {
                                            bgcolor: "rgba(245,158,11,0.22)",
                                          },
                                        }}>
                                        <StopIcon sx={{ fontSize: 14 }} />
                                      </IconButton>
                                    </Tooltip>
                                  ) : (
                                    <Tooltip
                                      title={
                                        fromRemote
                                          ? `Running by ${jobSt.runBy || "another session"}`
                                          : "Stop All in progress — use toolbar"
                                      }>
                                      <span>
                                        <IconButton
                                          size="small"
                                          disabled
                                          sx={{
                                            color: "#EF4444",
                                            bgcolor: "rgba(239,68,68,0.06)",
                                            borderRadius: 1.5,
                                            "&.Mui-disabled": { opacity: 0.35 },
                                          }}>
                                          <StopIcon sx={{ fontSize: 14 }} />
                                        </IconButton>
                                      </span>
                                    </Tooltip>
                                  )
                                ) : (
                                  /* Idle — show Run button */
                                  <Tooltip
                                    title={
                                      runAllMode
                                        ? "Run All in progress — use Stop All in toolbar"
                                        : running
                                          ? "Another account is running"
                                          : !["active", "warning"].includes(
                                                a.status,
                                              )
                                            ? "Resume account first"
                                            : `Run ${a.email}`
                                    }>
                                    <span>
                                      <IconButton
                                        size="small"
                                        onClick={() => handleRunOne(a)}
                                        disabled={!canRun}
                                        sx={{
                                          color: "#00E5FF",
                                          bgcolor: "rgba(0,229,255,0.08)",
                                          borderRadius: 1.5,
                                          "&:hover": {
                                            bgcolor: "rgba(0,229,255,0.18)",
                                          },
                                          "&.Mui-disabled": { opacity: 0.25 },
                                        }}>
                                        <PlayArrowIcon sx={{ fontSize: 14 }} />
                                      </IconButton>
                                    </span>
                                  </Tooltip>
                                )}

                                {/* Pause / Resume — disabled when account is actively processing */}
                                <Tooltip
                                  title={
                                    !canPause
                                      ? isActive
                                        ? "Stop the run first before pausing"
                                        : ""
                                      : ["active", "warning"].includes(a.status)
                                        ? "Pause account"
                                        : "Resume account"
                                  }>
                                  <span>
                                    <IconButton
                                      size="small"
                                      onClick={() => handleToggle(a)}
                                      disabled={!canPause}
                                      sx={{
                                        color: ["active", "warning"].includes(
                                          a.status,
                                        )
                                          ? "#F59E0B"
                                          : "#10B981",
                                        bgcolor: ["active", "warning"].includes(
                                          a.status,
                                        )
                                          ? "rgba(245,158,11,0.08)"
                                          : "rgba(16,185,129,0.08)",
                                        borderRadius: 1.5,
                                        "&:hover": {
                                          bgcolor: [
                                            "active",
                                            "warning",
                                          ].includes(a.status)
                                            ? "rgba(245,158,11,0.18)"
                                            : "rgba(16,185,129,0.18)",
                                        },
                                        "&.Mui-disabled": { opacity: 0.3 },
                                      }}>
                                      {["active", "warning"].includes(
                                        a.status,
                                      ) ? (
                                        <PauseIcon sx={{ fontSize: 14 }} />
                                      ) : (
                                        <ReplayIcon sx={{ fontSize: 14 }} />
                                      )}
                                    </IconButton>
                                  </span>
                                </Tooltip>

                                {/* Delete — disabled whenever account is actively processing by ANYONE */}
                                <Tooltip
                                  title={
                                    !canDelete
                                      ? "Cannot delete while account is processing — stop the run first"
                                      : "Disconnect account"
                                  }>
                                  <span>
                                    <IconButton
                                      size="small"
                                      onClick={() =>
                                        canDelete && setConfirmEmail(a.email)
                                      }
                                      disabled={!canDelete}
                                      sx={{
                                        color: "#EF4444",
                                        bgcolor: "rgba(239,68,68,0.08)",
                                        borderRadius: 1.5,
                                        "&:hover": {
                                          bgcolor: "rgba(239,68,68,0.18)",
                                        },
                                        "&.Mui-disabled": { opacity: 0.3 },
                                      }}>
                                      <DeleteOutlineIcon
                                        sx={{ fontSize: 14 }}
                                      />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              </Box>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Grid container spacing={2}>
                  {filtered.map((a) => {
                    const rate = a.stats?.successRate || 0;
                    const trend = a.stats?.trend || [100];
                    const jobSt = a.jobStatus || {};

                    // isActive: this account is currently being processed by ANY session/user
                    const isActive =
                      jobSt.phase &&
                      !["done", "idle", "error"].includes(jobSt.phase);
                    // fromRemote: being run by a different browser session (not this one)
                    const fromRemote = isActive && jobSt.fromRemote;
                    // isOwnRun: this browser is the one running it
                    const isOwnRun = isActive && !fromRemote;

                    const progress = jobSt.total
                      ? Math.round((jobSt.done / jobSt.total) * 100)
                      : 0;

                    // ── Action availability rules ──
                    // STOP: enabled whenever this account is actively processing (any session)
                    //       For remote runs, stopOne() sends stop signal via backend flag (future)
                    //       For now: stop button only works for own-session runs
                    const canStop = isOwnRun && !runAllMode;
                    // RUN: only when account is idle AND no other session running it AND not run-all mode
                    const canRun =
                      !isActive &&
                      !running &&
                      ["active", "warning"].includes(a.status);
                    // PAUSE/RESUME: only when account is idle (not being processed by anyone)
                    const canPause = !isActive;
                    // DELETE: only when account is NOT actively processing by anyone
                    // This is the key fix — disabled when ANY session is running this account
                    const canDelete = !isActive;
                    // const rate      =  0 //a.stats?.successRate || 0;

                    return (
                      <Grid item xs={12} sm={6} md={4} key={a.email}>
                        <Card
                          sx={{
                            border:
                              isActive && jobSt.total > 0
                                ? "1px solid rgba(124,58,237,0.45)"
                                : "1px solid rgba(255,255,255,0.06)",
                            height: "100%",
                            transition: "border 0.2s",
                          }}>
                          <CardContent>
                            {/* Header row */}
                            <Box
                              sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "flex-start",
                              }}>
                              <Typography
                                sx={{
                                  fontSize: 12,
                                  fontFamily: "DM Mono, monospace",
                                  wordBreak: "break-all",
                                  flex: 1,
                                  mr: 1,
                                }}>
                                {a.email}
                              </Typography>
                              <Chip
                                size="small"
                                label={ a.status }
                                color={
                                  a.status === "active"
                                       ? "success" : "default"
                                }
                                sx={{
                                  fontSize: 10,
                                  height: 20,
                                  fontFamily: "DM Mono, monospace",
                                  flexShrink: 0,
                                }}
                              />
                            </Box>

                            {/* Owner (admin sees it) */}
                            {isAdmin && a.owner && (
                              <Typography
                                variant="caption"
                                sx={{
                                  fontSize: 9,
                                  color: "text.disabled",
                                  fontFamily: "DM Mono, monospace",
                                  display: "block",
                                  mb: 1,
                                }}>
                                owner: {a.owner}
                              </Typography>
                            )}

                            {/* Rate */}
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                                mb: 1,
                              }}>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: "block" }}>
                                {(
                                  a.stats?.emailsProcessed || 0
                                ).toLocaleString()}{" "}
                                emails processed -{" "}
                                {(a.stats?.pixelsFired || 0).toLocaleString()}{" "}
                                beacons fired
                              </Typography>

                              <PhaseChip phase={jobSt.phase} />
                            </Box>

                            {/* Live progress bar */}
                            {isActive && jobSt.total > 0 && (
                              <Box sx={{ mb: 1.5 }}>
                                <Box
                                  sx={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    mb: 0.5,
                                  }}>
                                  {jobSt.runBy && (
                                    <Box
                                      sx={{
                                        px: 1,
                                        py: 0.2,
                                        borderRadius: 1,
                                        bgcolor: "rgba(0,229,255,0.08)",
                                        color: "#67E8F9",
                                        fontSize: 9,
                                        fontFamily: "DM Mono, monospace",
                                      }}>
                                      by {jobSt.runBy}
                                    </Box>
                                  )}
                                  {jobSt.message && (
                                    <Typography
                                      variant="caption"
                                      color="text.disabled"
                                      sx={{ fontSize: 9 }}>
                                      {jobSt.message}
                                    </Typography>
                                  )}
                                </Box>

                                <Box
                                  sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 1,
                                    mt: 0.75,
                                  }}>
                                  <LinearProgress
                                    variant="determinate"
                                    value={progress}
                                    sx={{
                                      flex: 1,
                                      height: 3,
                                      borderRadius: 2,
                                      bgcolor: "rgba(255,255,255,0.06)",
                                      "& .MuiLinearProgress-bar": {
                                        bgcolor: fromRemote
                                          ? "#00E5FF"
                                          : "#7C3AED",
                                      },
                                    }}
                                  />
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      fontSize: 9,
                                      color: fromRemote ? "#00E5FF" : "#7C3AED",
                                      fontFamily: "DM Mono, monospace",
                                      flexShrink: 0,
                                    }}>
                                    {jobSt.done}/{jobSt.total}
                                  </Typography>
                                </Box>
                              </Box>
                            )}

                            {/* ── Action buttons ── */}
                            <Box sx={{ display: "flex", gap: 1 }}>
                              {/* RUNNING → only Stop */}
                              {canStop ? (
                                <Tooltip title="Stop after current batch">
                                  <Button
                                    fullWidth
                                    size="small"
                                    variant="outlined"
                                    startIcon={<StopIcon />}
                                    onClick={() => handleStopOne(a.email)}
                                    sx={{
                                      color: "#EF4444",
                                      borderColor: "rgba(239,68,68,0.4)",
                                      fontSize: 11,
                                      "&:hover": {
                                        borderColor: "#EF4444",
                                        bgcolor: "rgba(239,68,68,0.08)",
                                      },
                                    }}>
                                    Stop
                                  </Button>
                                </Tooltip>
                              ) : isActive ? (
                                /* Account running in another session — admin gets amber signal button, others see disabled */
                                fromRemote && isAdmin ? (
                                  <Tooltip
                                    title={`Signal ${jobSt.runBy || "session"} to stop ${a.email}`}>
                                    <Button
                                      fullWidth
                                      size="small"
                                      variant="outlined"
                                      startIcon={<StopIcon />}
                                      onClick={() =>
                                        setAdmStopTarget({
                                          email: a.email,
                                          runBy: jobSt.runBy || "",
                                        })
                                      }
                                      sx={{
                                        color: "#F59E0B",
                                        borderColor: "rgba(245,158,11,0.4)",
                                        fontSize: 11,
                                        "&:hover": {
                                          borderColor: "#F59E0B",
                                          bgcolor: "rgba(245,158,11,0.08)",
                                        },
                                      }}>
                                      Stop
                                    </Button>
                                  </Tooltip>
                                ) : (
                                  <Tooltip
                                    title={
                                      fromRemote
                                        ? `Running by ${jobSt.runBy || "another session"}`
                                        : "Stop All in progress — use toolbar"
                                    }>
                                    <Button
                                      fullWidth
                                      size="small"
                                      variant="outlined"
                                      startIcon={<StopIcon />}
                                      onClick={() => setStopTarget(a.email)}
                                      sx={{
                                        color: "#EF4444",
                                        borderColor: "rgba(239,68,68,0.4)",
                                        fontSize: 11,
                                        "&:hover": {
                                          borderColor: "#EF4444",
                                          bgcolor: "rgba(239,68,68,0.08)",
                                        },
                                      }}>
                                      Stop
                                    </Button>
                                  </Tooltip>
                                )
                              ) : (
                                /* Idle — show Run button */
                                <Tooltip
                                  title={
                                    runAllMode
                                      ? "Run All in progress — use Stop All in toolbar"
                                      : running
                                        ? "Another account is running"
                                        : !["active", "warning"].includes(
                                              a.status,
                                            )
                                          ? "Resume account first"
                                          : `Run ${a.email}`
                                  }>
                                  <Button
                                    fullWidth
                                    size="small"
                                    variant="outlined"
                                    startIcon={<PlayArrowIcon />}
                                    onClick={() => handleRunOne(a)}
                                    disabled={!canRun}
                                    sx={{
                                      color: "#00E5FF",
                                      borderColor: "rgba(0,229,255,0.3)",
                                      fontSize: 11,
                                      "&:hover": {
                                        borderColor: "#00E5FF",
                                        bgcolor: "rgba(0,229,255,0.08)",
                                      },
                                      "&.Mui-disabled": { opacity: 0.3 },
                                    }}>
                                    Run
                                  </Button>
                                </Tooltip>
                              )}

                              {/* Pause / Resume — disabled when account is actively processing */}
                              <Tooltip
                                title={
                                  !canPause
                                    ? isActive
                                      ? "Stop the run first before pausing"
                                      : ""
                                    : ["active", "warning"].includes(a.status)
                                      ? "Pause account"
                                      : "Resume account"
                                }>
                                <Button
                                  fullWidth
                                  size="small"
                                  variant="outlined"
                                  startIcon={
                                    ["active", "warning"].includes(a.status) ? (
                                      <PauseIcon />
                                    ) : (
                                      <ReplayIcon />
                                    )
                                  }
                                  onClick={() => handleToggle(a)}
                                  disabled={!canPause}
                                  sx={{
                                    color: ["active", "warning"].includes(
                                      a.status,
                                    )
                                      ? "#F59E0B"
                                      : "#10B981",
                                    borderColor: ["active", "warning"].includes(
                                      a.status,
                                    )
                                      ? "rgba(245,158,11,0.3)"
                                      : "rgba(16,185,129,0.3)",
                                    fontSize: 11,
                                    "&:hover": {
                                      borderColor: [
                                        "active",
                                        "warning",
                                      ].includes(a.status)
                                        ? "#F59E0B"
                                        : "#10B981",
                                      bgcolor: ["active", "warning"].includes(
                                        a.status,
                                      )
                                        ? "rgba(245,158,11,0.08)"
                                        : "rgba(16,185,129,0.08)",
                                    },
                                  }}>
                                  {["active", "warning"].includes(a.status)
                                    ? "Pause"
                                    : "Resume"}
                                </Button>
                              </Tooltip>

                              {/* Delete */}
                              <Tooltip
                                title={
                                  !canDelete
                                    ? "Cannot delete while account is processing — stop the run first"
                                    : "Disconnect account"
                                }>
                                <span>
                                  <IconButton
                                    size="small"
                                    onClick={() =>
                                      canDelete && setConfirmEmail(a.email)
                                    }
                                    disabled={!canDelete}
                                    sx={{
                                      color: "#EF4444",
                                      bgcolor: "rgba(239,68,68,0.08)",
                                      borderRadius: 1.5,
                                      "&:hover": {
                                        bgcolor: "rgba(239,68,68,0.18)",
                                      },
                                      "&.Mui-disabled": { opacity: 0.3 },
                                    }}>
                                    <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            </Box>
                          </CardContent>
                        </Card>
                      </Grid>
                    );
                  })}
                </Grid>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!confirmEmail}
        title="Disconnect Account"
        message={`Remove ${confirmEmail} from PixelRelay? The Gmail account itself won't be affected.`}
        confirmLabel="Disconnect"
        confirmColor="error"
        onConfirm={handleRemove}
        onClose={() => setConfirmEmail(null)}
      />
      <ConfirmDialog
        open={!!admStopTarget}
        title="Signal remote stop"
        message={`Send a stop signal to ${admStopTarget?.runBy}'s session for ${admStopTarget?.email}? It will halt after the current batch.`}
        confirmLabel="Send Signal"
        confirmColor="warning"
        onConfirm={confirmAdmStop}
        onClose={() => setAdmStopTarget(null)}
      />
      <ConfirmDialog
        open={!!stopConfirmEmail}
        title="Stop processing?"
        message={`Send a stop signal to ${stopConfirmEmail}? It will finish its current batch then halt.`}
        confirmLabel="Stop"
        confirmColor="error"
        onConfirm={confirmStop}
        onClose={() => setStopConfirmEmail(null)}
      />
    </Box>
  );
}
