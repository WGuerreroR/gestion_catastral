export const getErrorMessage = (error, defaultMsg = 'Ocurrió un error') => {
    const detail = error?.response?.data?.detail
    if (!detail) return defaultMsg
    if (Array.isArray(detail)) return detail.map(d => d.msg).join(', ')
    if (typeof detail === 'string') return detail
    return defaultMsg
  }