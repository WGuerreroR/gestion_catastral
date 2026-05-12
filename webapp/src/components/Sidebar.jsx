import { useState } from 'react'
import {
  Box, Drawer, List, ListItem, ListItemButton,
  ListItemIcon, ListItemText, Typography, Divider,
  Avatar, Chip, Tooltip, IconButton, Collapse
} from '@mui/material'
import DashboardIcon         from '@mui/icons-material/Dashboard'
import PeopleIcon            from '@mui/icons-material/People'
import AdminPanelIcon        from '@mui/icons-material/AdminPanelSettings'
import AssignmentIcon        from '@mui/icons-material/Assignment'
import TravelExploreIcon     from '@mui/icons-material/TravelExplore'
import HomeWorkIcon          from '@mui/icons-material/HomeWork'
import LabelIcon             from '@mui/icons-material/Label'
import FlagOutlinedIcon      from '@mui/icons-material/FlagOutlined'
import SyncAltIcon           from '@mui/icons-material/SyncAlt'
import SwapHorizIcon         from '@mui/icons-material/SwapHoriz'
import TrackChangesIcon      from '@mui/icons-material/TrackChanges'
import WorkspacePremiumIcon  from '@mui/icons-material/WorkspacePremium'
import ChecklistIcon         from '@mui/icons-material/Checklist'
import LibraryAddCheckIcon   from '@mui/icons-material/LibraryAddCheck'
import VisibilityIcon        from '@mui/icons-material/Visibility'
import CheckCircleIcon       from '@mui/icons-material/CheckCircle'
import HourglassEmptyIcon    from '@mui/icons-material/HourglassEmpty'
import ExpandLessIcon        from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon        from '@mui/icons-material/ExpandMore'
import ChevronLeftIcon       from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon      from '@mui/icons-material/ChevronRight'
import Menu  from '@mui/icons-material/Menu'
import { useNavigate, useLocation } from 'react-router-dom'
import { useSelector } from 'react-redux'
import Logo from '../assets/ingicat.png'
import Logomini from '../assets/logo_mini.svg'

export const SIDEBAR_WIDTH        = 240
export const SIDEBAR_WIDTH_CLOSED = 64


const menuItems = [
  {
    label: 'Asignaciones',
    path:  '/asignaciones',
    icon:  <AssignmentIcon />,
    roles: []
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
    label: 'Marcas',
    path:  '/marcas',
    icon:  <FlagOutlinedIcon />,
    roles: []
  },
  {
    label: 'Tipos de marca',
    path:  '/tipos-marca',
    icon:  <LabelIcon />,
    roles: ['administrador']
  },
  {
    label: 'Seguimiento',
    path:  '/validacion',
    icon:  <TrackChangesIcon />,
    roles: ['administrador']
  },
  {
    label: 'Visor de predios',
    path:  '/predios/visor',
    icon:  <HomeWorkIcon />,
    roles: ['administrador', 'gerente', 'lider', 'ejecutor', 'supervisor']
  },
  // Item con submenú: Visores (enlaces externos)
  {
    label: 'Visores',
    icon:  <VisibilityIcon />,
    roles: ['administrador', 'gerente', 'lider', 'ejecutor', 'supervisor'],
    children: [
      {
        label: 'Validado',
        url:   'http://34.171.139.206:8600/',
        external: true,
        icon:  <CheckCircleIcon fontSize="small" />,
        roles: ['administrador', 'gerente', 'lider', 'ejecutor', 'supervisor']
      },
      {
        label: 'En proceso',
        url:   'http://34.171.139.206:8500/',
        external: true,
        icon:  <HourglassEmptyIcon fontSize="small" />,
        roles: ['administrador', 'gerente', 'lider', 'ejecutor', 'supervisor']
      }
    ]
  },
  /* {
      label: 'Calidad Externa',
      path:  '/calidad-externa',
      icon:  <TravelExploreIcon />,
      roles: ['administrador']
    },*/
  {
    label: 'Calidad por asignación',
    path:  '/calidad-asignaciones',
    icon:  <WorkspacePremiumIcon />,
    roles: ['administrador', 'supervisor']
  },
  {
    label: 'Validación de calidad',
    path:  '/validacion-calidad',
    icon:  <ChecklistIcon />,
    roles: ['administrador', 'supervisor', 'coordinador']
  },
  {
    label: 'Revisión masiva',
    path:  '/revision-masiva',
    icon:  <LibraryAddCheckIcon />,
    roles: ['administrador', 'supervisor', 'coordinador']
  },
  {
    label: 'Migración LADM',
    path:  '/migracion-ladm',
    icon:  <SyncAltIcon />,
    roles: ['administrador']
  },
  {
    label: 'INTERLIS / XTF',
    path:  '/interlis-xtf',
    icon:  <SwapHorizIcon />,
    roles: ['administrador']
  }
/* , {
    label: 'Dashboard',
    path:  '/dashboard',
    icon:  <DashboardIcon />,
    roles: ['administrador', 'gerente', 'lider', 'ejecutor']
  }*/
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
  const [openSubmenus, setOpenSubmenus] = useState({})

  const width = open ? SIDEBAR_WIDTH : SIDEBAR_WIDTH_CLOSED

  const hasRole = (roles) =>
    !roles || roles.length === 0 || user?.roles?.some(r => roles.includes(r))

  // Filtra padres y también sus hijos según rol
  const filtrados = menuItems
    .filter(item => hasRole(item.roles))
    .map(item =>
      item.children
        ? { ...item, children: item.children.filter(c => hasRole(c.roles)) }
        : item
    )

  const getIniciales = () => user?.nombre?.charAt(0).toUpperCase() || 'U'

  const handleToggle = () => {
    setOpen(!open)
    if (onToggle) onToggle(!open)
  }

  const handleSubmenuToggle = (label) => {
    // Si el sidebar está colapsado, lo abrimos primero
    if (!open) {
      setOpen(true)
      if (onToggle) onToggle(true)
    }
    setOpenSubmenus(prev => ({ ...prev, [label]: !prev[label] }))
  }

  // Verifica si alguna ruta hija está activa para resaltar el padre
  const isChildActive = (children) =>
    children?.some(c => !c.external && location.pathname === c.path)

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
        {!open && (
          <img
            src={Logomini}
            alt="Ingicat"
            style={{ height: 25, width: 'auto', marginLeft: '10px' }}
          />
        )}
        <IconButton onClick={handleToggle} size="small" sx={{ color: 'primary.main' }}>
          {open ? <ChevronLeftIcon /> : <ChevronRightIcon />}
        </IconButton>
      </Box>

      <Divider />

      {/* Menu items */}
      <List sx={{ px: 1, py: 1, flexGrow: 1, overflowY: 'auto' }}>
        {filtrados.map(item => {
          const hasChildren = item.children && item.children.length > 0
          const submenuOpen = !!openSubmenus[item.label]
          const childActive = isChildActive(item.children)

          // Item con submenú
          if (hasChildren) {
            return (
              <Box key={item.label}>
                <ListItem disablePadding sx={{ mb: 0.5 }}>
                  <Tooltip title={!open ? item.label : ''} placement="right">
                    <ListItemButton
                      onClick={() => handleSubmenuToggle(item.label)}
                      selected={childActive}
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
                        <>
                          <ListItemText
                            primary={item.label}
                            primaryTypographyProps={{ fontSize: 14, fontWeight: 500 }}
                          />
                          {submenuOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        </>
                      )}
                    </ListItemButton>
                  </Tooltip>
                </ListItem>

                <Collapse in={open && submenuOpen} timeout="auto" unmountOnExit>
                  <List component="div" disablePadding>
                    {item.children.map(child => (
                      <ListItem key={child.path || child.url} disablePadding sx={{ mb: 0.5 }}>
                        <ListItemButton
                          {...(child.external && child.url
                            ? {
                                component: 'a',
                                href: child.url,
                                target: '_blank',
                                rel: 'noopener noreferrer'
                              }
                            : {
                                onClick: () => navigate(child.path)
                              })}
                          selected={!child.external && location.pathname === child.path}
                          sx={{
                            borderRadius: 2,
                            pl: 4,
                            textDecoration: 'none',
                            color: 'inherit',
                            '&.Mui-selected': {
                              bgcolor: 'primary.main',
                              color: '#fff',
                              '& .MuiListItemIcon-root': { color: '#fff' },
                              '&:hover': { bgcolor: 'primary.dark' }
                            }
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 32, justifyContent: 'center' }}>
                            {child.icon}
                          </ListItemIcon>
                          <ListItemText
                            primary={child.label}
                            primaryTypographyProps={{ fontSize: 13, fontWeight: 500 }}
                          />
                        </ListItemButton>
                      </ListItem>
                    ))}
                  </List>
                </Collapse>
              </Box>
            )
          }

          // Item normal (sin hijos)
          return (
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
          )
        })}
      </List>
    </Drawer>
  )
}