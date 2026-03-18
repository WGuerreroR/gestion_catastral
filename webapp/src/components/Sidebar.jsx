import { useState } from 'react'
import {
  Box, Drawer, List, ListItem, ListItemButton,
  ListItemIcon, ListItemText, Typography, Divider,
  Avatar, Chip, Tooltip, IconButton
} from '@mui/material'
import DashboardIcon     from '@mui/icons-material/Dashboard'
import PeopleIcon        from '@mui/icons-material/People'
import AdminPanelIcon    from '@mui/icons-material/AdminPanelSettings'
import AssignmentIcon    from '@mui/icons-material/Assignment'
import MapIcon           from '@mui/icons-material/Map'
import ChevronLeftIcon   from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon  from '@mui/icons-material/ChevronRight'
import Menu  from '@mui/icons-material/Menu'
import { useNavigate, useLocation } from 'react-router-dom'
import { useSelector } from 'react-redux'
import Logo from '../assets/ingicat.png'
import Logomini from '../assets/logo_mini.svg'

export const SIDEBAR_WIDTH        = 240
export const SIDEBAR_WIDTH_CLOSED = 64


const menuItems = [
    {
      label: 'Dashboard',
      path:  '/dashboard',
      icon:  <DashboardIcon />,
      roles: ['administrador', 'gerente', 'lider', 'ejecutor']
    },
    {
      label: 'Personas',
      path:  '/personas',
      icon:  <PeopleIcon />,
      roles: ['administrador', 'gerente']
    },
    {
      label: 'Roles',
      path:  '/roles',
      icon:  <AdminPanelIcon />,
      roles: ['administrador']
    },
    {
      label: 'Asignaciones',
      path:  '/asignaciones',
      icon:  <AssignmentIcon />,
      roles: ['administrador', 'gerente', 'lider', 'ejecutor']
    }
  ]
  
  const coloresRol = {
    administrador: 'error',
    gerente:       'warning',
    lider:         'info',
    ejecutor:      'success'
  }

export default function Sidebar({ onToggle }) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const { user }  = useSelector(state => state.auth)
  const [open, setOpen] = useState(true)

  const width = open ? SIDEBAR_WIDTH : SIDEBAR_WIDTH_CLOSED

  const hasRole   = (roles) => user?.roles?.some(r => roles.includes(r))
  const filtrados = menuItems.filter(item => hasRole(item.roles))
  const getIniciales = () => user?.nombre?.charAt(0).toUpperCase() || 'U'

  const handleToggle = () => {
    setOpen(!open)
    if (onToggle) onToggle(!open)
  }

  return (
    <Drawer
      variant="permanent"
      sx={{
        width,
        flexShrink: 0,
        transition: 'width 0.2s ease',
        '& .MuiDrawer-paper': {
          width,
          boxSizing: 'border-box',
          borderRight: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'width 0.2s ease',
          top: 0,
          height: '100vh'
        }
      }}
    >
      {/* Logo + botón colapsar */}
      <Box sx={{
        p: open ? 2 : 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: open ? 'space-between' : 'center',
        bgcolor: '#fff',
        color: 'primary.main',
        minHeight: 64
      }}>
        {open && (
       <Box
       sx={{
         display: 'flex',
         alignItems: 'center',
         justifyContent: 'center',
         gap: 1.5,
         cursor: 'pointer',
         width: '100%'
       }}
       onClick={() => navigate('/dashboard')}
     >
       <img
         src={Logo}
         alt="Ingicat"
         style={{ height: 50, width: 'auto' }}
       />
     </Box>
     
     
        )}
        {!open && <img
         src={Logomini}
         alt="Ingicat"
         style={{ height: 25, width: 'auto' , marginLeft:'10px' }}
       />}
        <IconButton onClick={handleToggle} size="small" sx={{ color: 'primary.main' }}>
          {open ? <ChevronLeftIcon /> : <ChevronRightIcon />}
        </IconButton>
      </Box>

   
      <Divider />

      {/* Menu items */}
      <List sx={{ px: 1, py: 1, flexGrow: 1 }}>
        {filtrados.map(item => (
          <ListItem key={item.path} disablePadding sx={{ mb: 0.5 }}>
            <Tooltip title={!open ? item.label : ''} placement="right">
              <ListItemButton
                onClick={() => navigate(item.path)}
                selected={location.pathname === item.path}
                sx={{
                  borderRadius: 2,
                  justifyContent: open ? 'initial' : 'center',
                  px: open ? 2 : 1.5,
                  '&.Mui-selected': {
                    bgcolor: 'primary.main',
                    color: '#fff',
                    '& .MuiListItemIcon-root': { color: '#fff' },
                    '&:hover': { bgcolor: 'primary.dark' }
                  }
                }}
              >
                <ListItemIcon sx={{
                  minWidth: open ? 36 : 'auto',
                  justifyContent: 'center'
                }}>
                  {item.icon}
                </ListItemIcon>
                {open && (
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{ fontSize: 14, fontWeight: 500 }}
                  />
                )}
              </ListItemButton>
            </Tooltip>
          </ListItem>
        ))}
      </List>
    </Drawer>
  )
}