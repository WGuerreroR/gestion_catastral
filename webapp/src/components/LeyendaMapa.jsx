import { Box, Typography, Paper } from '@mui/material'

const estados = [
  { label: 'Sin asignar', color: 'rgba(200,200,200,0.6)',  border: '#888' },
  { label: 'Pendiente',   color: 'rgba(255,152,0,0.6)',    border: '#F57C00' },
  { label: 'En proceso',  color: 'rgba(33,150,243,0.6)',   border: '#1565C0' },
  { label: 'Completado',  color: 'rgba(76,175,80,0.6)',    border: '#2E7D32' },
  { label: 'Rechazado',   color: 'rgba(244,67,54,0.6)',    border: '#C62828' },
  { label: 'Seleccionado',color: 'rgba(156,39,176,0.5)',   border: '#6A1B9A' },
]

export default function LeyendaMapa() {
  return (
    <Paper sx={{ p: 1.5, position: 'absolute', bottom: 24, left: 12, zIndex: 1000, minWidth: 150 }}>
      <Typography variant="caption" fontWeight={600} display="block" mb={1}>
        Estado del predio
      </Typography>
      {estados.map(e => (
        <Box key={e.label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Box sx={{
            width: 18, height: 18, borderRadius: 1,
            bgcolor: e.color,
            border: `2px solid ${e.border}`
          }} />
          <Typography variant="caption">{e.label}</Typography>
        </Box>
      ))}
    </Paper>
  )
}