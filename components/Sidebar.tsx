import React, { useState } from 'react'
import Link from 'next/link'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  currentPage: 'home' | 'library' | 'memory' | 'tools' | 'settings'
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, currentPage }) => {
  const navItems = [
    { id: 'home', label: 'Home', href: '/' },
    { id: 'library', label: 'Memory Library', href: '/library' },
    { id: 'memory', label: 'Memory', href: '/memory', coming: true },
    { id: 'tools', label: 'Tools', href: '/tools', coming: true },
    { id: 'settings', label: 'Settings', href: '/settings', coming: true },
  ]

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            zIndex: 998,
            animation: 'fadeIn 0.3s ease-out',
          }}
        />
      )}

      {/* Sidebar */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '280px',
          height: '100vh',
          background: 'linear-gradient(180deg, #0a1420 0%, #0f1a2a 100%)',
          borderRight: '1px solid rgba(0, 168, 243, 0.1)',
          zIndex: 999,
          transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.3s ease-out',
          display: 'flex',
          flexDirection: 'column',
          backdropFilter: 'blur(10px)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '24px 20px',
            borderBottom: '1px solid rgba(0, 168, 243, 0.1)',
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: '18px',
              fontWeight: 600,
              color: '#e6eef6',
              letterSpacing: '0.5px',
            }}
          >
            Atlas
          </h1>
          <p
            style={{
              margin: '4px 0 0 0',
              fontSize: '12px',
              color: 'rgba(230, 238, 246, 0.5)',
            }}
          >
            Navigation
          </p>
        </div>

        {/* Navigation */}
        <nav
          style={{
            flex: 1,
            padding: '12px 8px',
            overflowY: 'auto',
          }}
        >
          {navItems.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              style={{
                display: 'block',
                padding: '12px 16px',
                margin: '4px 0',
                color:
                  currentPage === item.id
                    ? '#00a8f3'
                    : item.coming
                    ? 'rgba(230, 238, 246, 0.4)'
                    : '#e6eef6',
                textDecoration: 'none',
                fontSize: '14px',
                borderRadius: '6px',
                background:
                  currentPage === item.id
                    ? 'rgba(0, 168, 243, 0.1)'
                    : 'transparent',
                border:
                  currentPage === item.id
                    ? '1px solid rgba(0, 168, 243, 0.3)'
                    : '1px solid transparent',
                transition: 'all 0.2s ease-out',
                cursor: item.coming ? 'default' : 'pointer',
                opacity: item.coming ? 0.6 : 1,
                pointerEvents: item.coming ? 'none' : 'auto',
              } as any}
              onClick={(e: any) => {
                if (item.coming) {
                  e.preventDefault()
                } else {
                  onClose()
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>{item.label}</span>
                {item.coming && (
                  <span
                    style={{
                      fontSize: '10px',
                      color: 'rgba(0, 168, 243, 0.6)',
                      fontWeight: 500,
                      letterSpacing: '0.5px',
                    }}
                  >
                    COMING
                  </span>
                )}
              </div>
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid rgba(0, 168, 243, 0.1)',
            fontSize: '11px',
            color: 'rgba(230, 238, 246, 0.4)',
            textAlign: 'center',
          }}
        >
          <p style={{ margin: 0 }}>Atlas v0.1.0</p>
          <p style={{ margin: '4px 0 0 0' }}>Phase 1 • Memory Library</p>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        a {
          color: inherit;
          text-decoration: none;
        }
      `}</style>
    </>
  )
}

export default Sidebar
