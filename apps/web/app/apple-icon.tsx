import { ImageResponse } from 'next/og';
import { iconeJornada } from '@/lib/pwa/icone';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';
export default function AppleIcon() { return new ImageResponse(iconeJornada(180, false), size); }
