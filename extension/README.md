# POC — extension

Unpacked install: `chrome://extensions` → Developer mode → **Load unpacked** → select this folder.

Press **Cmd+Shift+P** on Claude, ChatGPT, or Gemini to summon the panel. **Esc** closes it.

## Two things to know
- **Invoked, not ambient.** POC only appears when summoned. A coach that interrupts mid-typing does not survive daily use.
- **Selectors will break.** `src/hosts.js` holds every DOM hook in one place because these sites change markup without notice. When a host stops working, that file is the only thing to fix.
