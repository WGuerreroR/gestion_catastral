import { useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Box, Toolbar } from '@mui/material'
import { useSelector } from 'react-redux'
import Login          from './pages/Login'
import Personas       from './pages/Personas'
import Roles         from './pages/Roles'
import Asignaciones         from './pages/Asignaciones'
import AsignacionDetalle        from './pages/AsignacionDetalle'
import Perfil         from './pages/Perfil'
import ProtectedRoute from './components/ProtectedRoute'
import Sidebar, { SIDEBAR_WIDTH, SIDEBAR_WIDTH_CLOSED } from './components/Sidebar'
import Navbar         from './components/Navbar'

const Dashboard    = () => <Box sx={{ p: 3 }}>Dashboard — próximamente</Box>


function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const sidebarWidth = sidebarOpen ? SIDEBAR_WIDTH : SIDEBAR_WIDTH_CLOSED

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar izquierdo */}
      <Sidebar onToggle={setSidebarOpen} />

      {/* Contenido derecho */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          transition: 'margin 0.2s ease',
          minHeight: '100vh',
          bgcolor: 'background.default'
        }}
      >
        {/* Navbar arriba */}
        <Navbar sidebarOpen={sidebarOpen} />
        <Toolbar /> {/* espacio para el AppBar fixed */}

        {/* Página */}
        <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
          {children}
        </Box>
      </Box>
    </Box>
  )
}

export default function App() {
  const { user } = useSelector(state => state.auth)

  return (
    <Routes>
      <Route path="/login" element={!user ? <Login /> : <Navigate to="/dashboard" />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard"    element={<Layout><Dashboard /></Layout>} />
        <Route path="/personas"     element={<Layout><Personas /></Layout>} />
        <Route path="/roles"        element={<Layout><Roles /></Layout>} />
        <Route path="/asignaciones" element={<Layout><Asignaciones /></Layout>} />
        <Route path="/asignaciones/:id" element={<Layout><AsignacionDetalle /></Layout>} />
        <Route path="/perfil"       element={<Layout><Perfil /></Layout>} />
      </Route>
      <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} />} />
    </Routes>
  )
}