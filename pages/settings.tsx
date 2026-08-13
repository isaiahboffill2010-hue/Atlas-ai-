import React, { useState } from 'react'
import Head from 'next/head'
import HamburgerMenu from '../components/HamburgerMenu'
import Sidebar from '../components/Sidebar'

export default function SettingsPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <>
      <Head>
        <title>Atlas Settings — Atlas Printers</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <HamburgerMenu isOpen={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)} />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} currentPage="settings" />

      <div
        style={{
          marginLeft: sidebarOpen ? '280px' : '0',
          width: '100%',
          height: '100vh',
          transition: 'margin-left 0.3s ease-out',
          background: 'linear-gradient(180deg, #071021 0%, #0e1a2a 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            color: 'rgba(230, 238, 246, 0.6)',
          }}
        >
          <h1
            style={{
              fontSize: '32px',
              margin: '0 0 12px 0',
              color: '#e6eef6',
            }}
          >
            Atlas Settings
          </h1>
          <p style={{ margin: 0, fontSize: '16px' }}>Coming in Phase 2</p>
          <p style={{ margin: '8px 0 0 0', fontSize: '13px', opacity: 0.7 }}>
            Configure Atlas behavior, integrations, and preferences.
          </p>
        </div>
      </div>
    </>
  )
}
