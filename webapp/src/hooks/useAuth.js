import { useSelector, useDispatch } from 'react-redux'
import { logout } from '../store/slices/authSlice'

export const useAuth = () => {
  const dispatch = useDispatch()
  const { user, token, loading, error } = useSelector(state => state.auth)

  return {
    user,
    token,
    loading,
    error,
    isAuthenticated: !!user,
    hasRole: (rol) => user?.roles?.includes(rol),
    logout: () => dispatch(logout())
  }
}