import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Burger House · Le cockpit',description:'Votre maison. Vos chiffres. Votre équipe. L’espace de gestion de Burger House Saint-Rambert-d’Albon.',manifest:'/manifest.webmanifest',applicationName:'Burger House',appleWebApp:{capable:true,title:'Burger House',statusBarStyle:'default'},icons:{icon:'/icons/icon-192.png',apple:'/icons/apple-touch-icon.png'},formatDetection:{telephone:false}};
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#f6f7f2'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="fr"><body>{children}</body></html>;}
