import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import PaintByNumberApp from './PaintByNumberApp'
import './paint-by-number.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root was not found')

createRoot(rootElement).render(<StrictMode><PaintByNumberApp /></StrictMode>)
