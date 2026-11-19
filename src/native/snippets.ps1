# Lumen — espansione snippet. Tiene in memoria solo gli ultimi 40 caratteri digitati (niente log, niente file).
# Quando il testo appena scritto finisce con una sigla (es. ";mail"), la cancella e scrive il testo associato.
param([string]$SnippetsFile)
$ErrorActionPreference = 'Stop'

$cs = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace LumenSnip {
  public static class Hook {
    delegate IntPtr Proc(int code, IntPtr w, IntPtr l);
    [StructLayout(LayoutKind.Sequential)] struct KBD { public uint vk, scan, flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KEYBDINPUT ki; [FieldOffset(8)] public long pad1; [FieldOffset(16)] public long pad2; [FieldOffset(24)] public long pad3; [FieldOffset(32)] public long pad4; }
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Proc fn, IntPtr mod, uint tid);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string n);
    [DllImport("user32.dll")] static extern short GetKeyState(int vk);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
    [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint tid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ToUnicodeEx(uint vk, uint scan, byte[] state, StringBuilder buf, int n, uint flags, IntPtr layout);
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);

    static Proc proc = Callback;
    static IntPtr hook;
    static StringBuilder buffer = new StringBuilder();
    static IntPtr lastWin = IntPtr.Zero;
    public static Dictionary<string, string> Snippets = new Dictionary<string, string>();

    public static void Start() {
      hook = SetWindowsHookEx(13, proc, GetModuleHandle(null), 0);
      Application.Run();
    }

    static IntPtr Callback(int code, IntPtr w, IntPtr l) {
      if (code >= 0 && (w.ToInt32() == 0x100 || w.ToInt32() == 0x104)) {
        var k = (KBD)Marshal.PtrToStructure(l, typeof(KBD));
        if ((k.flags & 0x10) == 0) OnKey(k);            // ignora i tasti inviati da programmi (anche i nostri)
      }
      return CallNextHookEx(hook, code, w, l);
    }

    static void OnKey(KBD k) {
      var fg = GetForegroundWindow();
      if (fg != lastWin) { buffer.Clear(); lastWin = fg; }
      uint vk = k.vk;
      if (vk == 0x08) { if (buffer.Length > 0) buffer.Length--; return; }
      if (vk == 0x0D || vk == 0x09 || vk == 0x1B || (vk >= 0x21 && vk <= 0x28)) { buffer.Clear(); return; }
      bool ctrl = GetAsyncKeyState(0x11) < 0, alt = GetAsyncKeyState(0x12) < 0;
      if (ctrl && !alt) { buffer.Clear(); return; }      // scorciatoie (Ctrl+C ecc.), ma non AltGr

      var state = new byte[256];
      if (GetAsyncKeyState(0x10) < 0) { state[0x10] = 0x80; state[0xA0] = 0x80; }
      if ((GetKeyState(0x14) & 1) != 0) state[0x14] = 1;
      if (ctrl && alt) { state[0x11] = 0x80; state[0x12] = 0x80; state[0xA2] = 0x80; state[0xA5] = 0x80; }
      var sb = new StringBuilder(8);
      var layout = GetKeyboardLayout(GetWindowThreadProcessId(fg, IntPtr.Zero));
      int n = ToUnicodeEx(vk, k.scan, state, sb, sb.Capacity, 4, layout);
      if (n <= 0) return;
      buffer.Append(sb.ToString(0, n));
      if (buffer.Length > 40) buffer.Remove(0, buffer.Length - 40);

      string typed = buffer.ToString();
      foreach (var kv in Snippets) {
        if (kv.Key.Length > 0 && typed.EndsWith(kv.Key, StringComparison.Ordinal)) {
          buffer.Clear();
          var trigger = kv.Key; var text = kv.Value;
          // Espansione fuori dal callback, dopo che il tasto corrente è arrivato all'app
          new System.Threading.Timer(_ => Expand(trigger.Length, text), null, 30, System.Threading.Timeout.Infinite);
          break;
        }
      }
    }

    static INPUT Key(ushort vk, ushort scan, uint flags) {
      var i = new INPUT(); i.type = 1; i.ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags }; return i;
    }
    static void Expand(int erase, string text) {
      var list = new List<INPUT>();
      for (int i = 0; i < erase; i++) { list.Add(Key(0x08, 0, 0)); list.Add(Key(0x08, 0, 2)); }
      foreach (char c in text.Replace("\r\n", "\n")) {
        if (c == '\n') { list.Add(Key(0x0D, 0, 0)); list.Add(Key(0x0D, 0, 2)); continue; }
        list.Add(Key(0, c, 4)); list.Add(Key(0, c, 6));          // KEYEVENTF_UNICODE (+ KEYUP)
      }
      var arr = list.ToArray();
      SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
    }
  }
}
'@
Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Windows.Forms

$list = Get-Content $SnippetsFile -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($s in @($list)) { if ($s.trigger) { [LumenSnip.Hook]::Snippets[[string]$s.trigger] = [string]$s.text } }
[Console]::Out.WriteLine('{"ready":true}')
[LumenSnip.Hook]::Start()
