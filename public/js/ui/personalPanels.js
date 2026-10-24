/** One dock, one open panel. Async profile loading must never reopen a panel the player left. */
export function createPersonalPanels({ bagPanel, loadProfile, blockProfile = () => {}, onError = () => {} }) {
  let profile = null, loading = null, pending = false, generation = 0;
  const active = () => pending || profile?.isOpen ? 'profile' : bagPanel.isOpen ? (bagPanel.activeTab === 'journal' ? 'journal' : 'bag') : null;
  function close() {
    generation++; pending = false; profile?.close(); bagPanel.close(); blockProfile(false);
  }
  async function toggle(name) {
    if (!['profile', 'bag', 'journal'].includes(name)) return;
    if (active() === name) { close(); return; }
    close();
    if (name !== 'profile') { bagPanel.openTab(name === 'journal' ? 'journal' : 'bag'); return; }
    const request = generation; pending = true; blockProfile(true);
    try {
      loading ||= Promise.resolve().then(loadProfile).finally(() => { loading = null; });
      const loaded = await loading; profile = loaded;
      if (request !== generation) return;
      pending = false; profile.open();
    } catch (error) {
      if (request !== generation) return;
      pending = false; blockProfile(false); onError(error);
    }
  }
  return { toggle, close, get active() { return active(); } };
}
