import { useState } from 'react'
import {
  AppBar, Toolbar, Typography, Box, IconButton,
  Avatar, Menu, MenuItem, Divider,
  Chip, Tooltip, ListItemIcon
} from '@mui/material'
import MapIcon           from '@mui/icons-material/Map'
import LogoutIcon        from '@mui/icons-material/Logout'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import { useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { logout } from '../store/slices/authSlice'
import { SIDEBAR_WIDTH, SIDEBAR_WIDTH_CLOSED } from './Sidebar'

const coloresRol = {
  admin:    'error',
  gerente:  'warning',
  lider:    'info',
  ejecutor: 'success'
}

export default function Navbar({ sidebarOpen }) {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const { user } = useSelector(state => state.auth)
  const [anchorEl, setAnchorEl] = useState(null)

  const handleLogout = () => {
    dispatch(logout())
    navigate('/login')
  }

  const getInitiales = () => {
    if (!user?.nombre) return 'U'
    return user.nombre.charAt(0).toUpperCase()
  }

  const sidebarWidth = sidebarOpen ? SIDEBAR_WIDTH : SIDEBAR_WIDTH_CLOSED

  return (
    <AppBar
      position="fixed"
      elevation={1}
      sx={{
        ml: `${sidebarWidth}px`,
        width: `calc(100% - ${sidebarWidth}px)`,
        transition: 'width 0.2s ease, margin 0.2s ease',
        bgcolor: 'background.paper',
        color: 'text.primary',
        borderBottom: '1px solid',
        borderColor: 'divider'
      }}
    >
      <Toolbar>
        {/* Logo */}
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }}
          onClick={() => navigate('/dashboard')}
        >
          <MapIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            Gestión Catastral
          </Typography>
        </Box>

        <Box sx={{ flexGrow: 1 }} />

        {/* Roles chips */}
        <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: 0.5, mr: 2 }}>
          {user?.roles?.map(rol => (
            <Chip
              key={rol}
              label={rol}
              size="small"
              color={coloresRol[rol] || 'default'}
              sx={{ fontWeight: 500 }}
            />
          ))}
        </Box>

        {/* Avatar + menú usuario */}
        <Tooltip title={user?.nombre || 'Usuario'}>
          <IconButton onClick={e => setAnchorEl(e.currentTarget)} sx={{ p: 0.5 }}>
            <Avatar sx={{ bgcolor: 'primary.main', width: 36, height: 36 }}>
              {getInitiales()}
            </Avatar>
          </IconButton>
        </Tooltip>

        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={() => setAnchorEl(null)}
          transformOrigin={{ horizontal: 'right', vertical: 'top' }}
          anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
          PaperProps={{ sx: { mt: 1, minWidth: 200 } }}
        >
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography variant="subtitle2" fontWeight={600}>
              {user?.nombre}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              ID: {user?.identificacion}
            </Typography>
          </Box>
          <Divider />
          <MenuItem onClick={() => { setAnchorEl(null); navigate('/perfil') }}>
            <ListItemIcon><AccountCircleIcon fontSize="small" /></ListItemIcon>
            Mi perfil
          </MenuItem>
          <Divider />
          <MenuItem onClick={handleLogout} sx={{ color: 'error.main' }}>
            <ListItemIcon><LogoutIcon fontSize="small" color="error" /></ListItemIcon>
            Cerrar sesión
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  )
}