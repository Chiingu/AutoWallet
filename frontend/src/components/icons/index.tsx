import googleSvg from '../../assets/icons/google.svg'

interface IconProps {
  className?: string
  alt?: string
}

export function GoogleIcon({ className = 'w-5 h-5 shrink-0', alt = 'Google' }: IconProps) {
  return <img src={googleSvg} alt={alt} className={className} />
}
