import React, { useState, useRef } from 'react'
import Head from 'next/head'
import HamburgerMenu from '../components/HamburgerMenu'
import Sidebar from '../components/Sidebar'
import LibraryDashboard from '../components/LibraryDashboard'
import AddKnowledgeModal from '../components/AddKnowledgeModal'

export default function LibraryPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const dashboardRef = useRef<{ refetch: () => Promise<void> }>(null)

  const handleRefresh = async () => {
    // Trigger a refresh of the library data without reloading the page
    if (dashboardRef.current?.refetch) {
      await dashboardRef.current.refetch()
    }
  }

  return (
    <>
      <Head>
        <title>Atlas Library — Atlas Printers</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <HamburgerMenu isOpen={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)} />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} currentPage="library" />

      <div
        style={{
          marginLeft: sidebarOpen ? '280px' : '0',
          width: '100%',
          height: '100vh',
          transition: 'margin-left 0.3s ease-out',
          overflow: 'hidden',
        }}
      >
        <LibraryDashboard ref={dashboardRef} onAddKnowledge={() => setModalOpen(true)} />
      </div>

      <AddKnowledgeModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSuccess={handleRefresh} />
    </>
  )
}
