/**
 * ConfirmDialog — reusable MUI confirmation dialog
 * Replaces all window.confirm() calls across the app.
 *
 * Usage:
 *   const [confirm, setConfirm] = useState(null);
 *   <ConfirmDialog
 *     open={!!confirm}
 *     title="Delete User"
 *     message="Are you sure you want to delete john? This cannot be undone."
 *     confirmLabel="Delete"
 *     confirmColor="error"
 *     onConfirm={() => { doDelete(); setConfirm(null); }}
 *     onClose={() => setConfirm(null)}
 *   />
 */

import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LinkOffIcon from '@mui/icons-material/LinkOff';

const icons = {
  error:   <DeleteOutlineIcon sx={{ fontSize: 32, color: '#EF4444', mb: 1 }} />,
  warning: <LinkOffIcon       sx={{ fontSize: 32, color: '#F59E0B', mb: 1 }} />,
  info:    <WarningAmberIcon  sx={{ fontSize: 32, color: '#00E5FF', mb: 1 }} />,
};

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  confirmColor = 'error',   // 'error' | 'warning' | 'primary'
  onConfirm,
  onClose,
}) {
  const colorMap = {
    error:   { bg: 'rgba(239,68,68,0.9)',   hover: 'rgba(239,68,68,1)'   },
    warning: { bg: 'rgba(245,158,11,0.9)',  hover: 'rgba(245,158,11,1)'  },
    primary: { bg: 'rgba(0,229,255,0.9)',   hover: 'rgba(0,229,255,1)'   },
  };
  const colors = colorMap[confirmColor] || colorMap.error;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 3,
          minWidth: 360,
          maxWidth: 420,
        },
      }}
    >
      <DialogTitle sx={{ pb: 0 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 700, color: 'text.primary' }}>
          {title}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: '12px !important' }}>
        <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.6 }}>
          {message}
        </Typography>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button
          size="small"
          onClick={onClose}
          sx={{
            color: 'text.secondary',
            bgcolor: 'rgba(255,255,255,0.05)',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.09)' },
            px: 2,
          }}
        >
          Cancel
        </Button>
        <Button
          size="small"
          variant="contained"
          onClick={onConfirm}
          sx={{
            bgcolor: colors.bg,
            color: '#fff',
            fontWeight: 700,
            px: 2,
            '&:hover': { bgcolor: colors.hover },
          }}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
