import React from 'react'

interface HamburgerMenuProps {
  isOpen: boolean
  onClick: () => void
}

export const HamburgerMenu: React.FC<HamburgerMenuProps> = ({ isOpen, onClick }) => {
  return (
    <button
      onClick={onClick}
      style={{
        position: 'fixed',
        top: '16px',
        left: '16px',
        width: '44px',
        height: '44px',
        background: 'rgba(15, 23, 32, 0.8)',
        border: '1px solid rgba(0, 168, 243, 0.2)',
        borderRadius: '8px',
        cursor: 'pointer',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(4px)',
        transition: 'all 0.3s ease-out',
        color: '#e6eef6',
        padding: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(15, 23, 32, 0.95)'
        e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.4)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(15, 23, 32, 0.8)'
        e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.2)'
      }}
      aria-label={isOpen ? 'Close menu' : 'Open menu'}
    >
      {isOpen ? (
        // X Icon
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="3" y1="3" x2="17" y2="17" />
          <line x1="17" y1="3" x2="3" y2="17" />
        </svg>
      ) : (
        // Hamburger Icon
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="3" y1="6" x2="17" y2="6" />
          <line x1="3" y1="10" x2="17" y2="10" />
          <line x1="3" y1="14" x2="17" y2="14" />
        </svg>
      )}
    </button>
  )
}

export default HamburgerMenu
