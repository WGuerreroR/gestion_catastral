import { createContext, useContext } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { loginThunk, logout } from '../store/slices/authSlice'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const dispatch = useDispatch()
  const { user, loading, error } = useSelector(state => state.auth)

  const login = async (username, password) => {
    return dispatch(loginThunk({ username, password })).unwrap()
  }

  const logoutUser = () => dispatch(logout())

  const hasRole = (rol) => user?.roles?.includes(rol)

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout: logoutUser, hasRole }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)