import {
    Dialog, DialogTitle, DialogContent,
    Grid, Card, CardActionArea, CardContent,
    Typography, Box
  } from '@mui/material'
  import DrawIcon   from '@mui/icons-material/Draw'
  import UploadIcon from '@mui/icons-material/Upload'
  import SearchIcon from '@mui/icons-material/Search'
  
  const metodos = [
    {
      id:          'poligono',
      label:       'Dibujar polígono',
      descripcion: 'Dibuja un área en el mapa y se seleccionan los predios dentro',
      icon:        <DrawIcon sx={{ fontSize: 40 }} color="primary" />
    },
    {
      id:          'shapefile',
      label:       'Cargar shapefile',
      descripcion: 'Carga un archivo .zip con .shp y se seleccionan los predios dentro',
      icon:        <UploadIcon sx={{ fontSize: 40 }} color="secondary" />
    },
    {
      id:          'manzana',
      label:       'Código de manzana',
      descripcion: 'Busca por código de manzana y asigna todos los predios dentro',
      icon:        <SearchIcon sx={{ fontSize: 40 }} color="warning" />
    }
  ]
  
  export default function ModalMetodoAsignacion({ open, onClose, onSelect }) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>¿Cómo quieres asignar los predios?</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5, pb: 1 }}>
            {metodos.map(m => (
              <Grid item xs={12} sm={4} key={m.id}>
                <Card sx={{
                  height: '100%',
                  transition: 'box-shadow 0.2s',
                  '&:hover': { boxShadow: 4 }
                }}>
                  <CardActionArea
                    onClick={() => onSelect(m.id)}
                    sx={{ height: '100%' }}
                  >
                    <CardContent sx={{ textAlign: 'center' }}>
                      <Box sx={{ mb: 1 }}>{m.icon}</Box>
                      <Typography variant="subtitle2" fontWeight={600} mb={0.5}>
                        {m.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {m.descripcion}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
        </DialogContent>
      </Dialog>
    )
  }