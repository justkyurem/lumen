# Lumen native helper: riceve richieste JSON (una per riga) su stdin e risponde su stdout.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$cs = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Lumen {
  public class WinInfo { public long hwnd; public int pid; public string title; public string exe; public int x, y, w, h; public bool min; public bool max; public bool cap; public bool full; }

  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int f(); int g(); int h(); int i();
    int SetMasterVolumeLevelScalar(float fLevel, Guid ctx);
    int j();
    int GetMasterVolumeLevelScalar(out float level);
    int k(); int l(); int m(); int n();
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid ctx);
    int GetMute(out bool mute);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice { int Activate(ref Guid id, int clsCtx, int p, out IAudioEndpointVolume aev); }
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ep); }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }

  public static class Native {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte sc, uint f, UIntPtr e);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT v, int s);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint a, bool i, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int f, StringBuilder s, ref int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int SystemParametersInfo(int a, int b, string c, int d);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, string l, uint f, uint t, out UIntPtr r);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHEmptyRecycleBin(IntPtr h, string root, uint flags);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHQueryRecycleBin(string root, ref SHQUERYRBINFO info);
    [DllImport("powrprof.dll")] static extern bool SetSuspendState(bool hibernate, bool force, bool disableWake);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    [StructLayout(LayoutKind.Sequential)] public struct SHQUERYRBINFO { public int cbSize; public long size; public long items; }

    static Dictionary<int, string> exeCache = new Dictionary<int, string>();
    static Dictionary<string, string> descCache = new Dictionary<string, string>();

    public static string ExePath(int pid) {
      string s;
      if (exeCache.TryGetValue(pid, out s)) return s;
      s = "";
      IntPtr h = OpenProcess(0x1000, false, pid);
      if (h != IntPtr.Zero) {
        var sb = new StringBuilder(1024); int n = sb.Capacity;
        if (QueryFullProcessImageName(h, 0, sb, ref n)) s = sb.ToString();
        CloseHandle(h);
      }
      if (exeCache.Count > 500) exeCache.Clear();
      exeCache[pid] = s;
      return s;
    }

    public static string Describe(string exe) {
      if (string.IsNullOrEmpty(exe)) return "";
      string d;
      if (descCache.TryGetValue(exe, out d)) return d;
      try { d = FileVersionInfo.GetVersionInfo(exe).FileDescription; } catch { d = null; }
      if (string.IsNullOrWhiteSpace(d)) d = System.IO.Path.GetFileNameWithoutExtension(exe);
      descCache[exe] = d.Trim();
      return descCache[exe];
    }

    static WinInfo Info(IntPtr h) {
      int pid; GetWindowThreadProcessId(h, out pid);
      var sb = new StringBuilder(GetWindowTextLength(h) + 1); GetWindowText(h, sb, sb.Capacity);
      RECT r; GetWindowRect(h, out r);
      return new WinInfo { hwnd = h.ToInt64(), pid = pid, title = sb.ToString(), exe = ExePath(pid),
        x = r.L, y = r.T, w = r.R - r.L, h = r.B - r.T, min = IsIconic(h), max = IsZoomed(h),
        cap = (GetWindowLong(h, -16) & 0x00C00000) == 0x00C00000, full = IsFullscreen(h, r) };
    }

    // Schermo intero: la finestra copre tutto il suo monitor e non è una normale finestra ingrandita con la barra del titolo.
    // Il confronto avviene qui, con le coordinate dello stesso processo, così non dipende dal ridimensionamento DPI.
    static bool IsFullscreen(IntPtr h, RECT r) {
      if (IsIconic(h)) return false;
      var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return false;
      var m = mi.rcMonitor;
      bool covers = r.L <= m.L + 1 && r.T <= m.T + 1 && r.R >= m.R - 1 && r.B >= m.B - 1;
      bool caption = (GetWindowLong(h, -16) & 0x00C00000) == 0x00C00000;
      if (covers) return !(IsZoomed(h) && caption);
      // App senza bordi ingrandite (giochi, shell in Python, kiosk): l'area di lavoro può escludere barra e dock riservati
      return IsZoomed(h) && !caption;
    }

    static bool IsAppWindow(IntPtr h) {
      if (!IsWindowVisible(h)) return false;
      if (GetWindow(h, 4) != IntPtr.Zero) return false;          // ha un owner
      if ((GetWindowLong(h, -20) & 0x80) != 0) return false;      // WS_EX_TOOLWINDOW
      if (GetWindowTextLength(h) == 0) return false;
      int cloaked; DwmGetWindowAttribute(h, 14, out cloaked, 4);
      return cloaked == 0;
    }

    public static List<WinInfo> Windows(int excludePid) {
      var list = new List<WinInfo>();
      EnumWindows((h, l) => {
        if (IsAppWindow(h)) {
          var i = Info(h);
          if (i.pid != excludePid && i.title != "Program Manager") list.Add(i);
        }
        return true;
      }, IntPtr.Zero);
      return list;
    }

    public static WinInfo Foreground() {
      var h = GetForegroundWindow();
      return h == IntPtr.Zero ? null : Info(h);
    }

    public static void Focus(long hwnd) {
      var h = new IntPtr(hwnd);
      if (IsIconic(h)) ShowWindow(h, 9);
      keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); // sblocca SetForegroundWindow
      SetForegroundWindow(h);
    }
    public static void Minimize(long hwnd) { ShowWindow(new IntPtr(hwnd), 6); }
    public static void Close(long hwnd) { PostMessage(new IntPtr(hwnd), 0x0010, IntPtr.Zero, IntPtr.Zero); }
    public static void Bottom(long hwnd) { SetWindowPos(new IntPtr(hwnd), new IntPtr(1), 0, 0, 0, 0, 0x0013); }

    public static void Place(IntPtr h, int x, int y, int w, int hh) {
      RECT win, frame; GetWindowRect(h, out win);
      if (DwmGetWindowAttribute(h, 9, out frame, Marshal.SizeOf(typeof(RECT))) != 0) frame = win;
      int l = frame.L - win.L, t = frame.T - win.T, r = win.R - frame.R, b = win.B - frame.B;
      SetWindowPos(h, IntPtr.Zero, x - l, y - t, w + l + r, hh + t + b, 0x0014);
    }

    public static bool Snap(string where) {
      var h = GetForegroundWindow();
      if (h == IntPtr.Zero) return false;
      var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(mi);
      GetMonitorInfo(MonitorFromWindow(h, 2), ref mi);
      var a = mi.rcWork; int W = a.R - a.L, H = a.B - a.T, X = a.L, Y = a.T;
      if (where == "max") { ShowWindow(h, 3); return true; }
      if (IsZoomed(h) || IsIconic(h)) ShowWindow(h, 9);
      switch (where) {
        case "left": Place(h, X, Y, W / 2, H); break;
        case "right": Place(h, X + W / 2, Y, W - W / 2, H); break;
        case "top": Place(h, X, Y, W, H / 2); break;
        case "bottom": Place(h, X, Y + H / 2, W, H - H / 2); break;
        case "tl": Place(h, X, Y, W / 2, H / 2); break;
        case "tr": Place(h, X + W / 2, Y, W - W / 2, H / 2); break;
        case "bl": Place(h, X, Y + H / 2, W / 2, H - H / 2); break;
        case "br": Place(h, X + W / 2, Y + H / 2, W - W / 2, H - H / 2); break;
        case "left3": Place(h, X, Y, W / 3, H); break;
        case "center3": Place(h, X + W / 3, Y, W / 3, H); break;
        case "right3": Place(h, X + 2 * W / 3, Y, W - 2 * W / 3, H); break;
        case "center": {
          RECT r; GetWindowRect(h, out r);
          int w = Math.Min(r.R - r.L, W), hh = Math.Min(r.B - r.T, H);
          SetWindowPos(h, IntPtr.Zero, X + (W - w) / 2, Y + (H - hh) / 2, 0, 0, 0x0015); break;
        }
        case "almost": Place(h, X + W / 12, Y + H / 12, W * 5 / 6, H * 5 / 6); break;
        default: return false;
      }
      return true;
    }

    public static void MoveRaw(long hwnd, int x, int y, int w, int hh, bool max) {
      var h = new IntPtr(hwnd);
      if (IsZoomed(h) || IsIconic(h)) ShowWindow(h, 9);
      SetWindowPos(h, IntPtr.Zero, x, y, w, hh, 0x0014);
      if (max) ShowWindow(h, 3);
    }

    static IAudioEndpointVolume Vol() {
      var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
      IMMDevice dev; Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
      IAudioEndpointVolume v; var iid = typeof(IAudioEndpointVolume).GUID;
      Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, 0, out v));
      return v;
    }
    public static float GetVolume() { float f; Vol().GetMasterVolumeLevelScalar(out f); return f; }
    public static void SetVolume(float f) { Vol().SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(1, f)), Guid.Empty); }
    public static bool GetMute() { bool m; Vol().GetMute(out m); return m; }
    public static void SetMute(bool m) { Vol().SetMute(m, Guid.Empty); }

    public static void Key(byte vk) { keybd_event(vk, 0, 1, UIntPtr.Zero); keybd_event(vk, 0, 3, UIntPtr.Zero); }
    public static void Paste() {
      keybd_event(0x11, 0, 0, UIntPtr.Zero); keybd_event(0x56, 0, 0, UIntPtr.Zero);
      keybd_event(0x56, 0, 2, UIntPtr.Zero); keybd_event(0x11, 0, 2, UIntPtr.Zero);
    }

    public static void Wallpaper(string p) { SystemParametersInfo(20, 0, p, 3); }
    public static void BroadcastTheme() { UIntPtr r; SendMessageTimeout(new IntPtr(0xffff), 0x1A, UIntPtr.Zero, "ImmersiveColorSet", 2, 200, out r); }

    public static long RecycleCount() { var i = new SHQUERYRBINFO(); i.cbSize = Marshal.SizeOf(i); SHQueryRecycleBin(null, ref i); return i.items; }
    public static void EmptyRecycle() { SHEmptyRecycleBin(IntPtr.Zero, null, 7); }
    public static void Sleep() { SetSuspendState(false, false, false); }

    // --- Appunti: numero di sequenza + flag dei password manager ---
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] static extern bool IsClipboardFormatAvailable(uint f);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterClipboardFormat(string n);
    static uint fmtExclude = 0, fmtNoHistory = 0;
    public static long[] ClipInfo() {
      if (fmtExclude == 0) { fmtExclude = RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing"); fmtNoHistory = RegisterClipboardFormat("CanIncludeInClipboardHistory"); }
      bool ex = IsClipboardFormatAvailable(fmtExclude) || IsClipboardFormatAvailable(fmtNoHistory);
      return new long[] { GetClipboardSequenceNumber(), ex ? 1 : 0 };
    }

    // --- AppBar: riserva spazio in alto per la barra dei menu ---
    [StructLayout(LayoutKind.Sequential)] public struct APPBARDATA { public int cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge; public RECT rc; public IntPtr lParam; }
    [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA d);
    public static void AppBar(long hwnd, int l, int t, int r, int b) {
      var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(d); d.hWnd = new IntPtr(hwnd); d.uCallbackMessage = 0x8000 + 77;
      SHAppBarMessage(0, ref d);
      d.uEdge = 1; d.rc.L = l; d.rc.T = t; d.rc.R = r; d.rc.B = b;
      SHAppBarMessage(2, ref d);
      d.rc.B = d.rc.T + (b - t);
      SHAppBarMessage(3, ref d);
    }
    // --- Animazioni di sistema ---
    [StructLayout(LayoutKind.Sequential)] public struct ANIMATIONINFO { public uint cbSize; public int iMinAnimate; }
    [DllImport("user32.dll", EntryPoint = "SystemParametersInfoW")] static extern bool SpiAnim(uint a, uint b, ref ANIMATIONINFO c, uint d);
    [DllImport("user32.dll", EntryPoint = "SystemParametersInfoW")] static extern bool SpiBoolGet(uint a, uint b, out bool c, uint d);
    [DllImport("user32.dll", EntryPoint = "SystemParametersInfoW")] static extern bool SpiBoolSet(uint a, uint b, IntPtr c, uint d);
    public static bool GetAnimations() {
      var ai = new ANIMATIONINFO(); ai.cbSize = (uint)Marshal.SizeOf(ai);
      SpiAnim(0x0048, ai.cbSize, ref ai, 0);
      bool client; SpiBoolGet(0x1042, 0, out client, 0);
      return ai.iMinAnimate != 0 || client;
    }
    public static void SetAnimations(bool on) {
      var ai = new ANIMATIONINFO(); ai.cbSize = (uint)Marshal.SizeOf(ai); ai.iMinAnimate = on ? 1 : 0;
      SpiAnim(0x0049, ai.cbSize, ref ai, 3);                                   // animazione apri/chiudi finestre
      SpiBoolSet(0x1043, 0, new IntPtr(on ? 1 : 0), 3);                        // animazioni nelle finestre
      SpiBoolSet(0x1003, 0, new IntPtr(on ? 1 : 0), 3);                        // animazione menu
      SpiBoolSet(0x1005, 0, new IntPtr(on ? 1 : 0), 3);                        // effetto combo box
      SpiBoolSet(0x1007, 0, new IntPtr(on ? 1 : 0), 3);                        // scorrimento liste fluido
      SpiBoolSet(0x1019, 0, new IntPtr(on ? 1 : 0), 3);                        // ombra cursore
      SpiBoolSet(0x1025, 0, new IntPtr(on ? 1 : 0), 3);                        // ombre sotto i menu
    }

    // --- Barra delle applicazioni di Windows: nascondi automaticamente (come dalle impostazioni di Windows) ---
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string name);
    public static bool GetTaskbarAutoHide() {
      var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(d); d.hWnd = FindWindow("Shell_TrayWnd", null);
      return (SHAppBarMessage(4, ref d).ToUInt64() & 1) != 0;              // ABM_GETSTATE, ABS_AUTOHIDE
    }
    public static void SetTaskbarAutoHide(bool on) {
      var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(d); d.hWnd = FindWindow("Shell_TrayWnd", null);
      d.lParam = new IntPtr(on ? 1 : 0);
      SHAppBarMessage(10, ref d);                                          // ABM_SETSTATE
    }

    // --- Combinazioni di tasti (desktop virtuali, Centro notifiche…) ---
    static bool IsExtended(byte vk) { return (vk >= 0x21 && vk <= 0x2E) || vk == 0x5B || vk == 0x5C; }
    public static void Combo(int[] vks) {
      foreach (var v in vks) keybd_event((byte)v, 0, IsExtended((byte)v) ? 1u : 0u, UIntPtr.Zero);
      for (int i = vks.Length - 1; i >= 0; i--) keybd_event((byte)vks[i], 0, (IsExtended((byte)vks[i]) ? 1u : 0u) | 2u, UIntPtr.Zero);
    }

    public static void AppBarRemove(long hwnd) {
      var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(d); d.hWnd = new IntPtr(hwnd);
      SHAppBarMessage(1, ref d);
    }

    // AppBar sul bordo inferiore (dock): Windows lo posiziona sopra la barra delle applicazioni se è visibile.
    // Restituisce il rettangolo effettivamente riservato.
    public static int[] AppBarBottom(long hwnd, int l, int t, int r, int b) {
      var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(d); d.hWnd = new IntPtr(hwnd); d.uCallbackMessage = 0x8000 + 78;
      SHAppBarMessage(0, ref d);
      int h = b - t;
      d.uEdge = 3; d.rc.L = l; d.rc.T = t; d.rc.R = r; d.rc.B = b;
      SHAppBarMessage(2, ref d);
      d.rc.T = d.rc.B - h;
      SHAppBarMessage(3, ref d);
      return new int[] { d.rc.L, d.rc.T, d.rc.R, d.rc.B };
    }
  }
}
'@
Add-Type -TypeDefinition $cs -Language CSharp

# ---------- Icone delle app (anche quelle dello Store), compilate solo quando servono ----------
$iconCs = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
namespace LumenIcons {
  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm); }
  [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx, cy; }
  [StructLayout(LayoutKind.Sequential)] struct BITMAP { public int bmType, bmWidth, bmHeight, bmWidthBytes; public ushort bmPlanes, bmBitsPixel; public IntPtr bmBits; }
  public static class Icons {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory f);
    [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int c, ref BITMAP b);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
    public static string Get(string parsing, int size) {
      IShellItemImageFactory f = null; IntPtr hbm = IntPtr.Zero;
      try {
        SHCreateItemFromParsingName(parsing, IntPtr.Zero, typeof(IShellItemImageFactory).GUID, out f);
        SIZE s; s.cx = size; s.cy = size;
        if (f.GetImage(s, 0x1 | 0x4, out hbm) != 0 || hbm == IntPtr.Zero) return null; // BIGGERSIZEOK | ICONONLY
        BITMAP b = new BITMAP();
        GetObject(hbm, Marshal.SizeOf(typeof(BITMAP)), ref b);
        Bitmap outBmp;
        if (b.bmBits != IntPtr.Zero && b.bmBitsPixel == 32) {
          using (var src = new Bitmap(b.bmWidth, b.bmHeight, b.bmWidthBytes, PixelFormat.Format32bppPArgb, b.bmBits)) {
            outBmp = new Bitmap(src);
          }
          outBmp.RotateFlip(RotateFlipType.RotateNoneFlipY); // le DIB sono capovolte
        } else outBmp = Image.FromHbitmap(hbm);
        using (outBmp) using (var ms = new MemoryStream()) { outBmp.Save(ms, ImageFormat.Png); return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray()); }
      } finally {
        if (hbm != IntPtr.Zero) DeleteObject(hbm);
        if (f != null) Marshal.ReleaseComObject(f);
      }
    }
  }
}
'@
function Get-AppIcons($ids, [int]$size) {
  if (-not ('LumenIcons.Icons' -as [type])) { Add-Type -TypeDefinition $iconCs -ReferencedAssemblies System.Drawing }
  $o = @{}
  foreach ($id in $ids) { try { $r = [LumenIcons.Icons]::Get("shell:AppsFolder\$id", $size); if ($r) { $o[$id] = $r } } catch {} }
  $o
}

# ---------- WinRT (caricato solo quando serve) ----------
$script:winrt = $false
function Init-WinRT {
  if ($script:winrt) { return }
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $null = [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
  $script:winrt = $true
}
function Await($op, [Type]$t) {
  $task = $script:asTask.MakeGenericMethod($t).Invoke($null, @($op))
  if (-not $task.Wait(3000)) { throw 'timeout' }
  $task.Result
}

function Get-Media {
  Init-WinRT
  $M = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
  $mgr = Await ($M::RequestAsync()) $M
  $s = $mgr.GetCurrentSession()
  if (-not $s) { return $null }
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  @{ title = $p.Title; artist = $p.Artist; app = $s.SourceAppUserModelId; playing = ($s.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') }
}

function Get-Radios {
  Init-WinRT
  $R = [Windows.Devices.Radios.Radio]
  $null = Await ($R::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
  Await ($R::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
}

function Get-RadioState {
  $out = @{ wifi = $null; bluetooth = $null; ssid = $null }
  foreach ($r in (Get-Radios)) {
    $k = $r.Kind.ToString()
    if ($k -eq 'WiFi') { $out.wifi = ($r.State.ToString() -eq 'On') }
    if ($k -eq 'Bluetooth') { $out.bluetooth = ($r.State.ToString() -eq 'On') }
  }
  try {
    $line = (netsh wlan show interfaces) | Where-Object { $_ -match '^\s*SSID\s*:' } | Select-Object -First 1
    if ($line) { $out.ssid = ($line -split ':', 2)[1].Trim() }
  } catch {}
  $out
}

function Set-Radio($kind, [bool]$on) {
  $state = if ($on) { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
  foreach ($r in (Get-Radios)) {
    if ($r.Kind.ToString() -eq $kind) { $null = Await ($r.SetStateAsync($state)) ([Windows.Devices.Radios.RadioAccessStatus]) }
  }
  $true
}

$PERS = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
$PUSH = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications'

function Search-Files($q, $n) {
  $q = ($q -replace "'", "''") -replace '[%_\[]', ''
  $root = ($env:USERPROFILE -replace '\\', '/')
  $c = New-Object -ComObject ADODB.Connection
  $c.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
  $top = $n * 5
  $sql = "SELECT TOP $top System.ItemUrl, System.ItemName, System.ItemType FROM SYSTEMINDEX WHERE SCOPE='file:$root' AND System.ItemName LIKE '%$q%' ORDER BY System.DateModified DESC"
  $rs = $c.Execute($sql)
  $res = @()
  while (-not $rs.EOF -and $res.Count -lt $n) {
    $url = [string]$rs.Fields.Item('System.ItemUrl').Value
    # Salta cartelle di sistema e di sviluppo che riempirebbero i risultati di rumore
    if ($url -notmatch '/(AppData|node_modules|\.git|\.cargo|\.nuget|__pycache__|site-packages)/') {
      $p = [Uri]::UnescapeDataString(($url -replace '^file:', '')) -replace '/', '\'
      $res += @{ path = $p; name = $rs.Fields.Item('System.ItemName').Value; type = $rs.Fields.Item('System.ItemType').Value }
    }
    $rs.MoveNext()
  }
  $c.Close()
  , $res
}

# ---------- Prestazioni ----------
$BG = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications'
$CDM = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager'
$TIPS = @('SubscribedContent-338389Enabled', 'SubscribedContent-338388Enabled', 'SubscribedContent-310093Enabled', 'SubscribedContent-353694Enabled', 'SubscribedContent-353696Enabled', 'SystemPaneSuggestionsEnabled', 'SoftLandingEnabled', 'SilentInstalledAppsEnabled')
$PLAN_HIGH = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'
$PLAN_BAL = '381b4222-f694-41f0-9685-ff5bb260df2e'
$PLAN_SAVER = 'a1841308-3541-4fab-bc81-f71556f20b4a'

function Reg-Get($path, $name, $default) { try { $v = (Get-ItemProperty $path -Name $name -ErrorAction Stop).$name; if ($null -eq $v) { $default } else { $v } } catch { $default } }
function Reg-Set($path, $name, $value) { if (-not (Test-Path $path)) { New-Item $path -Force | Out-Null }; Set-ItemProperty $path $name $value -Type DWord }

function Get-Plans {
  $active = $null
  if ((powercfg /getactivescheme) -match '([0-9a-f]{8}-[0-9a-f-]{27})') { $active = $Matches[1] }
  $list = @()
  foreach ($l in (powercfg /list)) {
    if ($l -match '([0-9a-f]{8}-[0-9a-f-]{27})\s+\((.+?)\)') { $list += @{ id = $Matches[1]; name = $Matches[2] } }
  }
  @{ active = $active; list = $list }
}

function Get-Perf {
  @{
    animations   = [Lumen.Native]::GetAnimations()
    transparency = ((Reg-Get $PERS 'EnableTransparency' 1) -ne 0)
    background   = ((Reg-Get $BG 'GlobalUserDisabled' 0) -eq 0)
    tips         = ((Reg-Get $CDM 'SubscribedContent-338389Enabled' 1) -ne 0 -or (Reg-Get $CDM 'SystemPaneSuggestionsEnabled' 1) -ne 0)
    power        = Get-Plans
  }
}

function Set-Perf($key, $on) {
  switch ($key) {
    'animations'   { [Lumen.Native]::SetAnimations([bool]$on) }
    'transparency' { Reg-Set $PERS 'EnableTransparency' ([int][bool]$on); [Lumen.Native]::BroadcastTheme() }
    'background'   { Reg-Set $BG 'GlobalUserDisabled' ([int](-not [bool]$on)) }
    'tips'         { foreach ($t in $TIPS) { Reg-Set $CDM $t ([int][bool]$on) } }
    'power'        { powercfg /setactive $on | Out-Null }
  }
  $true
}

# App all'avvio, gestite come in Gestione attività (chiavi StartupApproved: 02 = attiva, 03 = disattivata)
$RUN_U = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RUN_M = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'
$APR_U = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
$APR_M = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
$APR_F = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder'

function Approved($path, $name) {
  try { $b = (Get-ItemProperty $path -Name $name -ErrorAction Stop).$name; return (($b[0] -band 1) -eq 0) } catch { return $true }
}
function Get-Startup {
  $out = @()
  foreach ($src in @(@{ run = $RUN_U; apr = $APR_U; scope = 'user'; editable = $true }, @{ run = $RUN_M; apr = $APR_M; scope = 'machine'; editable = $false })) {
    try { $props = Get-ItemProperty $src.run -ErrorAction Stop } catch { continue }
    foreach ($p in $props.PSObject.Properties) {
      if ($p.Name -like 'PS*') { continue }
      $out += @{ name = $p.Name; command = [string]$p.Value; scope = $src.scope; kind = 'run'; editable = $src.editable; enabled = (Approved $src.apr $p.Name) }
    }
  }
  $folder = [Environment]::GetFolderPath('Startup')
  foreach ($f in (Get-ChildItem $folder -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'desktop.ini' })) {
    $out += @{ name = $f.Name; command = $f.FullName; scope = 'user'; kind = 'folder'; editable = $true; enabled = (Approved $APR_F $f.Name) }
  }
  , $out
}
function Set-Startup($name, $kind, [bool]$enabled) {
  $path = if ($kind -eq 'folder') { $APR_F } else { $APR_U }
  if (-not (Test-Path $path)) { New-Item $path -Force | Out-Null }
  $bytes = [byte[]](@($(if ($enabled) { 2 } else { 3 })) + (@(0) * 11))
  Set-ItemProperty $path $name $bytes -Type Binary
  $true
}

function Temp-Files {
  $limit = (Get-Date).AddDays(-1)
  Get-ChildItem $env:TEMP -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $limit }
}
function Clean-Temp([bool]$dry) {
  $files = @(Temp-Files)
  $size = ($files | Measure-Object Length -Sum).Sum
  if ($dry) { return @{ bytes = [long]$size; count = $files.Count } }
  $freed = 0; $n = 0
  foreach ($f in $files) { try { $len = $f.Length; Remove-Item $f.FullName -Force -ErrorAction Stop; $freed += $len; $n++ } catch {} }
  # cartelle vuote rimaste
  Get-ChildItem $env:TEMP -Recurse -Directory -Force -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending |
    Where-Object { -not (Get-ChildItem $_.FullName -Force -ErrorAction SilentlyContinue) } | ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
  @{ bytes = [long]$freed; count = $n }
}

$PROTECTED = @('system', 'idle', 'registry', 'smss', 'csrss', 'wininit', 'services', 'lsass', 'winlogon', 'svchost', 'dwm', 'explorer', 'fontdrvhost',
  'memory compression', 'msmpeng', 'securityhealthservice', 'spoolsv', 'audiodg', 'sihost', 'ctfmon', 'searchindexer', 'powershell', 'conhost', 'lumen', 'electron', 'runtimebroker', 'taskhostw', 'nissrv', 'wudfhost', 'lsaiso', 'vmmem', 'vmmemwsl')
function Top-Procs($n) {
  $list = Get-Process | Group-Object ProcessName | ForEach-Object {
    $first = $_.Group | Where-Object { $_.Path } | Select-Object -First 1
    $desc = $null
    if ($first) { try { $desc = $first.MainModule.FileVersionInfo.FileDescription } catch {} }
    @{ name = $_.Name; label = $(if ($desc) { $desc } else { $_.Name }); mem = [long](($_.Group | Measure-Object WorkingSet64 -Sum).Sum); count = $_.Count; path = $(if ($first) { $first.Path } else { $null }) }
  } | Where-Object { $PROTECTED -notcontains $_.name.ToLower() } | Sort-Object { $_.mem } -Descending | Select-Object -First $n
  , @($list)
}

# App preinstallate superflue (solo per l'utente corrente, reinstallabili dal Microsoft Store)
$BLOAT = [ordered]@{
  'Microsoft.BingNews' = 'Microsoft Notizie'; 'Microsoft.BingWeather' = 'Meteo (Microsoft)'; 'Microsoft.BingFinance' = 'Finanza'; 'Microsoft.BingSports' = 'Sport'
  'Microsoft.GetHelp' = 'Assistenza'; 'Microsoft.Getstarted' = 'Suggerimenti'; 'Microsoft.MicrosoftSolitaireCollection' = 'Solitaire Collection'
  'Microsoft.People' = 'Persone'; 'Microsoft.MicrosoftOfficeHub' = 'Microsoft 365 (Office Hub)'; 'Microsoft.SkypeApp' = 'Skype'
  'Clipchamp.Clipchamp' = 'Clipchamp'; 'Microsoft.WindowsFeedbackHub' = 'Hub di Feedback'; 'Microsoft.Todos' = 'Microsoft To Do'
  'Microsoft.PowerAutomateDesktop' = 'Power Automate'; 'Microsoft.549981C3F5F10' = 'Cortana'; 'Microsoft.WindowsMaps' = 'Mappe'
  'Microsoft.ZuneVideo' = 'Film e TV'; 'Microsoft.MixedReality.Portal' = 'Portale realtà mista'; 'Microsoft.Microsoft3DViewer' = 'Visualizzatore 3D'
  'Microsoft.3DBuilder' = '3D Builder'; 'Microsoft.Print3D' = 'Print 3D'; 'Microsoft.Messaging' = 'Messaggi'; 'Microsoft.OneConnect' = 'Piani mobili'
  'Microsoft.Wallet' = 'Wallet'; 'Microsoft.MicrosoftJournal' = 'Journal'; 'MicrosoftTeams' = 'Teams (personale)'; 'Microsoft.Windows.DevHome' = 'Dev Home'
  'king.com.*' = 'Giochi King (Candy Crush…)'; '*TikTok*' = 'TikTok'; '*Disney*' = 'Disney+'; '*.LinkedInforWindows' = 'LinkedIn'
}
function Get-Bloat {
  $all = Get-AppxPackage -ErrorAction SilentlyContinue
  $out = @()
  foreach ($k in $BLOAT.Keys) {
    $found = @($all | Where-Object { $_.Name -like $k -and -not $_.NonRemovable })
    if ($found.Count) { $out += @{ id = $k; label = $BLOAT[$k]; packages = @($found | ForEach-Object { $_.PackageFullName }) } }
  }
  , $out
}
function Remove-Bloat($ids) {
  $done = @()
  $all = Get-AppxPackage -ErrorAction SilentlyContinue
  foreach ($id in $ids) {
    if (-not $BLOAT.Contains($id)) { continue }   # solo voci della lista nota
    foreach ($p in @($all | Where-Object { $_.Name -like $id -and -not $_.NonRemovable })) {
      try { Remove-AppxPackage -Package $p.PackageFullName -ErrorAction Stop; $done += $id } catch {}
    }
  }
  , @($done | Select-Object -Unique)
}

# ---------- Desktop virtuali ----------
function Get-Desktops {
  $k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops'
  $p = Get-ItemProperty $k -ErrorAction SilentlyContinue
  $ids = @()
  if ($p -and $p.VirtualDesktopIDs) {
    $b = [byte[]]$p.VirtualDesktopIDs
    for ($i = 0; $i + 16 -le $b.Length; $i += 16) { $ids += ([Guid]::new([byte[]]$b[$i..($i + 15)])).ToString() }
  }
  $cur = $null
  if ($p -and $p.CurrentVirtualDesktop) { $cur = ([Guid]::new([byte[]]$p.CurrentVirtualDesktop)).ToString() }
  if (-not $ids.Count) { $ids = @('default'); $cur = 'default' }
  @{ ids = $ids; current = $cur; index = [Math]::Max(0, [array]::IndexOf($ids, $cur)) }
}
function Switch-Desktop([int]$target) {
  $d = Get-Desktops
  $diff = $target - $d.index
  $vk = if ($diff -gt 0) { 0x27 } else { 0x25 }   # freccia destra / sinistra
  for ($i = 0; $i -lt [Math]::Abs($diff); $i++) { [Lumen.Native]::Combo(@(0x11, 0x5B, $vk)); Start-Sleep -Milliseconds 120 }
  $true
}

# ---------- File selezionati in Esplora file ----------
function Get-ExplorerSelection([long]$hwnd) {
  $shell = New-Object -ComObject Shell.Application
  foreach ($w in @($shell.Windows())) {
    try {
      if ([long]$w.HWND -ne $hwnd) { continue }
      $sel = @($w.Document.SelectedItems() | ForEach-Object { $_.Path })
      if ($sel.Count) { return , $sel }
    } catch {}
  }
  , @()
}

function Handle($cmd, $a) {
  switch ($cmd) {
    'ping'        { 'pong' }
    'windows'     { , @([Lumen.Native]::Windows([int]$a.exclude)) }
    'foreground'  { $w = [Lumen.Native]::Foreground(); if ($w) { $w | Add-Member -NotePropertyName name -NotePropertyValue ([Lumen.Native]::Describe($w.exe)) -PassThru } }
    'describe'    { [Lumen.Native]::Describe($a.exe) }
    'focus'       { [Lumen.Native]::Focus([long]$a.hwnd); $true }
    'minimize'    { [Lumen.Native]::Minimize([long]$a.hwnd); $true }
    'close'       { [Lumen.Native]::Close([long]$a.hwnd); $true }
    'bottom'      { [Lumen.Native]::Bottom([long]$a.hwnd); $true }
    'snap'        { [Lumen.Native]::Snap([string]$a.where) }
    'move'        { foreach ($w in $a.list) { [Lumen.Native]::MoveRaw([long]$w.hwnd, $w.x, $w.y, $w.w, $w.h, [bool]$w.max) }; $true }
    'volume'      { @{ level = [Lumen.Native]::GetVolume(); muted = [Lumen.Native]::GetMute() } }
    'setVolume'   { [Lumen.Native]::SetVolume([float]$a.level); $true }
    'setMute'     { [Lumen.Native]::SetMute([bool]$a.muted); $true }
    'brightness'  { try { (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness } catch { $null } }
    'setBrightness' { Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte]$a.level } | Out-Null; $true }
    'media'       { Get-Media }
    'mediaKey'    { $vk = @{ play = 0xB3; next = 0xB0; prev = 0xB1 }[$a.key]; [Lumen.Native]::Key([byte]$vk); $true }
    'radios'      { Get-RadioState }
    'setRadio'    { Set-Radio $a.kind ([bool]$a.on) }
    'darkMode'    { ((Get-ItemProperty $PERS -ErrorAction SilentlyContinue).AppsUseLightTheme -eq 0) }
    'setDarkMode' {
      $v = if ($a.on) { 0 } else { 1 }
      Set-ItemProperty $PERS AppsUseLightTheme $v -Type DWord; Set-ItemProperty $PERS SystemUsesLightTheme $v -Type DWord
      [Lumen.Native]::BroadcastTheme(); $true }
    'dnd'         { ((Get-ItemProperty $PUSH -ErrorAction SilentlyContinue).ToastEnabled -eq 0) }
    'setDnd'      { if (-not (Test-Path $PUSH)) { New-Item $PUSH -Force | Out-Null }; Set-ItemProperty $PUSH ToastEnabled ([int](-not $a.on)) -Type DWord; $true }
    'showDesktop' { (New-Object -ComObject Shell.Application).ToggleDesktop(); $true }
    'recycleCount'{ [Lumen.Native]::RecycleCount() }
    'emptyRecycle'{ [Lumen.Native]::EmptyRecycle(); $true }
    'wallpaper'   { [Lumen.Native]::Wallpaper([string]$a.path); $true }
    'paste'       { [Lumen.Native]::Paste(); $true }
    'clipInfo'    { $r = [Lumen.Native]::ClipInfo(); @{ seq = $r[0]; exclude = ($r[1] -eq 1) } }
    'desktops'    { Get-Desktops }
    'switchDesktop' { Switch-Desktop ([int]$a.index) }
    'newDesktop'  { [Lumen.Native]::Combo(@(0x11, 0x5B, 0x44)); $true }        # Ctrl+Win+D
    'closeDesktop'{ [Lumen.Native]::Combo(@(0x11, 0x5B, 0x73)); $true }        # Ctrl+Win+F4
    'winNotifications' { [Lumen.Native]::Combo(@(0x5B, 0x4E)); $true }         # Win+N
    'explorerSel' { Get-ExplorerSelection ([long]$a.hwnd) }
    'taskbar'     { [Lumen.Native]::GetTaskbarAutoHide() }
    'setTaskbar'  { [Lumen.Native]::SetTaskbarAutoHide([bool]$a.hide); $true }
    'appBar'      { [Lumen.Native]::AppBar([long]$a.hwnd, $a.l, $a.t, $a.r, $a.b); $true }
    'appBarBottom'{ , @([Lumen.Native]::AppBarBottom([long]$a.hwnd, $a.l, $a.t, $a.r, $a.b)) }
    'appBarRemove'{ foreach ($h in $a.hwnds) { [Lumen.Native]::AppBarRemove([long]$h) }; $true }
    'sleep'       { [Lumen.Native]::Sleep(); $true }
    'appIcons'    { Get-AppIcons $a.ids ([int]$a.size) }
    'startApps'   { , @(Get-StartApps | ForEach-Object { @{ name = $_.Name; id = $_.AppID } }) }
    'searchFiles' { Search-Files $a.q ([int]$a.n) }
    'perf'        { Get-Perf }
    'setPerf'     { Set-Perf $a.key $a.on }
    'startup'     { Get-Startup }
    'setStartup'  { Set-Startup $a.name $a.kind ([bool]$a.enabled) }
    'cleanTemp'   { Clean-Temp ([bool]$a.dry) }
    'topProcs'    { Top-Procs ([int]$a.n) }
    'bloat'       { Get-Bloat }
    'removeBloat' { Remove-Bloat @($a.ids) }
    'killProc'    { Get-Process -Name $a.name -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Kill() } catch {} }; $true }
    default       { throw "comando sconosciuto: $cmd" }
  }
}

[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  $id = $null
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    $data = Handle $req.cmd $req.args
    $out = @{ id = $id; ok = $true; data = $data }
  } catch {
    $out = @{ id = $id; ok = $false; error = "$($_.Exception.Message)" }
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $out -Compress -Depth 6))
}
