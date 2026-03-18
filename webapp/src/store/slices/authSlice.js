import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '../../api/axios'

// Acción asíncrona para login
export const loginThunk = createAsyncThunk(
  'auth/login',
  async ({ username, password }, { rejectWithValue }) => {
    try {
      const { data } = await api.post('/auth/login', { username, password })
      const payload = JSON.parse(atob(data.access_token.split('.')[1]))
      localStorage.setItem('token', data.access_token)
      return { token: data.access_token, user: payload }
    } catch (error) {
      return rejectWithValue(error.response?.data?.detail || 'Error al iniciar sesión')
    }
  }
)

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    user: (() => {
      try {
        const token = localStorage.getItem('token')
        return token ? JSON.parse(atob(token.split('.')[1])) : null
      } catch { return null }
    })(),
    token: localStorage.getItem('token'),
    loading: false,
    error: null
  },
  reducers: {
    logout: (state) => {
      state.user  = null
      state.token = null
      state.error = null
      localStorage.removeItem('token')
    },
    clearError: (state) => {
      state.error = null
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginThunk.pending, (state) => {
        state.loading = true
        state.error   = null
      })
      .addCase(loginThunk.fulfilled, (state, action) => {
        state.loading = false
        state.user    = action.payload.user
        state.token   = action.payload.token
      })
      .addCase(loginThunk.rejected, (state, action) => {
        state.loading = false
        state.error   = action.payload
      })
  }
})

export const { logout, clearError } = authSlice.actions
export default authSlice.reducer