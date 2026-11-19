# Lumen — motore di analisi e pulizia del disco.
# Deriva da PuliDisco.ps1 (scansione C#, categorie di pulizia, report): stesse regole di sicurezza,
# ma comandato da Lumen via JSON invece che dal menu interattivo.
$ErrorActionPreference = 'Continue'

if (-not ('PuliDisco.Scanner' -as [type])) {
    Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;

namespace PuliDisco {
    public class Entry {
        public string FullPath;
        public string Name;
        public long Bytes;
        public long Files;
        public long Failed;
        public bool IsDir;
        public DateTime Modified;
    }

    public static class Scanner {
        static bool IsDir(FileSystemInfo f)  { return (f.Attributes & FileAttributes.Directory) != 0; }
        static bool IsLink(FileSystemInfo f) { return (f.Attributes & FileAttributes.ReparsePoint) != 0; }
        static string NameOf(string p) {
            string n = Path.GetFileName(p.TrimEnd('\\'));
            return string.IsNullOrEmpty(n) ? p : n;
        }
        static int BySizeDesc(Entry a, Entry b) { return b.Bytes.CompareTo(a.Bytes); }

        // Dimensione totale di una cartella (non segue junction/symlink)
        public static Entry DirSize(string path) {
            Entry e = new Entry(); e.FullPath = path; e.Name = NameOf(path); e.IsDir = true;
            try { e.Modified = Directory.GetLastWriteTime(path); } catch {}
            if (!Directory.Exists(path)) return e;
            Stack<string> stack = new Stack<string>(); stack.Push(path);
            while (stack.Count > 0) {
                string cur = stack.Pop();
                try {
                    foreach (FileSystemInfo f in new DirectoryInfo(cur).EnumerateFileSystemInfos()) {
                        try {
                            if (IsDir(f)) { if (!IsLink(f)) stack.Push(f.FullName); }
                            else { e.Bytes += ((FileInfo)f).Length; e.Files++; }
                        } catch { e.Failed++; }
                    }
                } catch { e.Failed++; }
            }
            return e;
        }

        // Contenuto immediato di una cartella con dimensioni (sottocartelle calcolate in parallelo)
        public static Entry[] Children(string path) {
            List<Entry> result = new List<Entry>();
            List<string> dirs = new List<string>();
            try {
                foreach (FileSystemInfo f in new DirectoryInfo(path).EnumerateFileSystemInfos()) {
                    try {
                        if (IsDir(f)) { if (!IsLink(f)) dirs.Add(f.FullName); }
                        else {
                            Entry e = new Entry(); e.FullPath = f.FullName; e.Name = f.Name;
                            e.Bytes = ((FileInfo)f).Length; e.Files = 1; e.Modified = f.LastWriteTime;
                            result.Add(e);
                        }
                    } catch {}
                }
            } catch {}
            Entry[] dirEntries = new Entry[dirs.Count];
            ParallelOptions po = new ParallelOptions(); po.MaxDegreeOfParallelism = 8;
            Parallel.For(0, dirs.Count, po, i => { dirEntries[i] = DirSize(dirs[i]); });
            result.AddRange(dirEntries);
            result.Sort(BySizeDesc);
            return result.ToArray();
        }

        // I "count" file più grandi sotto un percorso
        public static Entry[] TopFiles(string path, int count, long minBytes) {
            List<Entry> list = new List<Entry>();
            Stack<string> stack = new Stack<string>(); stack.Push(path);
            while (stack.Count > 0) {
                string cur = stack.Pop();
                try {
                    foreach (FileSystemInfo f in new DirectoryInfo(cur).EnumerateFileSystemInfos()) {
                        try {
                            if (IsDir(f)) { if (!IsLink(f)) stack.Push(f.FullName); continue; }
                            long len = ((FileInfo)f).Length;
                            if (len < minBytes) continue;
                            Entry e = new Entry(); e.FullPath = f.FullName; e.Name = f.Name;
                            e.Bytes = len; e.Files = 1; e.Modified = f.LastWriteTime;
                            list.Add(e);
                            if (list.Count > count * 4) {
                                Trim(list, count);
                                minBytes = Math.Max(minBytes, list[list.Count - 1].Bytes);
                            }
                        } catch {}
                    }
                } catch {}
            }
            Trim(list, count);
            return list.ToArray();
        }
        static void Trim(List<Entry> l, int n) {
            l.Sort(BySizeDesc);
            if (l.Count > n) l.RemoveRange(n, l.Count - n);
        }

        // Trova cartelle con un certo nome (es. node_modules) senza entrarci dentro
        public static Entry[] FindDirs(string root, string[] names, string[] skip) {
            HashSet<string> nameSet = new HashSet<string>(names, StringComparer.OrdinalIgnoreCase);
            HashSet<string> skipSet = new HashSet<string>(skip, StringComparer.OrdinalIgnoreCase);
            List<string> found = new List<string>();
            Stack<string> stack = new Stack<string>(); stack.Push(root);
            while (stack.Count > 0) {
                string cur = stack.Pop();
                try {
                    foreach (DirectoryInfo d in new DirectoryInfo(cur).EnumerateDirectories()) {
                        try {
                            if (IsLink(d)) continue;
                            if (nameSet.Contains(d.Name)) found.Add(d.FullName);
                            // salta cartelle nascoste di tool (.cache, .codex, .vscode...) e quelle in skip:
                            // lì dentro i node_modules sono installazioni di programmi, non progetti
                            else if (!skipSet.Contains(d.Name) && !d.Name.StartsWith(".")) stack.Push(d.FullName);
                        } catch {}
                    }
                } catch {}
            }
            Entry[] res = new Entry[found.Count];
            ParallelOptions po = new ParallelOptions(); po.MaxDegreeOfParallelism = 8;
            Parallel.For(0, found.Count, po, i => {
                res[i] = DirSize(found[i]);
                try { res[i].Modified = Directory.GetLastWriteTime(Path.GetDirectoryName(found[i])); } catch {}
            });
            List<Entry> l = new List<Entry>(res);
            l.Sort(BySizeDesc);
            return l.ToArray();
        }

        // Cancella il contenuto di una cartella. olderThanDays>0 = solo file non modificati da N giorni.
        // dryRun = calcola soltanto. File bloccati/in uso vengono saltati.
        public static Entry DeleteContents(string path, int olderThanDays, bool removeRoot, bool dryRun) {
            Entry e = new Entry(); e.FullPath = path; e.Name = NameOf(path); e.IsDir = true;
            if (!Directory.Exists(path)) return e;
            DateTime cutoff = DateTime.Now.AddDays(-olderThanDays);
            List<string> dirs = new List<string>();
            Stack<string> stack = new Stack<string>(); stack.Push(path);
            while (stack.Count > 0) {
                string cur = stack.Pop();
                try {
                    foreach (FileSystemInfo f in new DirectoryInfo(cur).EnumerateFileSystemInfos()) {
                        try {
                            if (IsDir(f)) {
                                if (IsLink(f)) {
                                    // rimuove solo il collegamento, mai il contenuto a cui punta
                                    if (olderThanDays <= 0 && !dryRun) { try { Directory.Delete(f.FullName, false); } catch { e.Failed++; } }
                                    continue;
                                }
                                dirs.Add(f.FullName); stack.Push(f.FullName); continue;
                            }
                            if (olderThanDays > 0 && f.LastWriteTime > cutoff) continue;
                            long len = ((FileInfo)f).Length;
                            if (dryRun) { e.Bytes += len; e.Files++; continue; }
                            try {
                                if ((f.Attributes & FileAttributes.ReadOnly) != 0)
                                    f.Attributes = f.Attributes & ~FileAttributes.ReadOnly;
                                f.Delete();
                                e.Bytes += len; e.Files++;
                            } catch { e.Failed++; }
                        } catch { e.Failed++; }
                    }
                } catch { e.Failed++; }
            }
            if (!dryRun) {
                for (int i = dirs.Count - 1; i >= 0; i--) { try { Directory.Delete(dirs[i], false); } catch {} }
                if (removeRoot) { try { Directory.Delete(path, false); } catch {} }
            }
            return e;
        }
    }
}
'@
}

# ---------------------------------------------------------------------------
#  Utility
# ---------------------------------------------------------------------------
$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

function Format-Size([double]$b) {
    if ($b -ge 1TB) { return '{0:N2} TB' -f ($b / 1TB) }
    if ($b -ge 1GB) { return '{0:N2} GB' -f ($b / 1GB) }
    if ($b -ge 1MB) { return '{0:N1} MB' -f ($b / 1MB) }
    if ($b -ge 1KB) { return '{0:N0} KB' -f ($b / 1KB) }
    return "$([int64]$b) B"
}

function Get-Bar([double]$fraction, [int]$width = 20) {
    $fraction = [math]::Max(0, [math]::Min(1, $fraction))
    $n = [int][math]::Round($fraction * $width)
    return ('█' * $n) + ('░' * ($width - $n))
}

function Write-Title([string]$t) {
    Write-Host ''
    Write-Host "== $t ==" -ForegroundColor Cyan
}

function Read-Selection([string]$prompt, [int]$max) {
    # Accetta: "1,3,5"  "2-6"  "tutti"
    $s = (Read-Host $prompt).Trim().ToLower()
    if (-not $s) { return @() }
    if ($s -in 'tutti', 'tutto', 'all', '*') { return 1..$max }
    $out = New-Object System.Collections.Generic.List[int]
    foreach ($part in $s -split '[,; ]+') {
        if ($part -match '^(\d+)-(\d+)$') { [int]$matches[1]..[int]$matches[2] | ForEach-Object { $out.Add($_) } }
        elseif ($part -match '^\d+$') { $out.Add([int]$part) }
    }
    return $out | Where-Object { $_ -ge 1 -and $_ -le $max } | Sort-Object -Unique
}

function Confirm-Yes([string]$msg) {
    Write-Host $msg -ForegroundColor Yellow
    return ((Read-Host 'Scrivi SI per confermare') -ceq 'SI')
}

function Get-RecycleBinSize {
    try {
        $shell = New-Object -ComObject Shell.Application
        $items = $shell.Namespace(0xA).Items()
        $sum = 0L; $count = 0
        foreach ($i in $items) { $sum += [int64]$i.ExtendedProperty('Size'); $count++ }
        return [pscustomobject]@{ Bytes = $sum; Files = $count }
    } catch { return [pscustomobject]@{ Bytes = 0L; Files = 0 } }
}

function Get-BrowserCachePaths([string]$userDataDir) {
    if (-not (Test-Path $userDataDir)) { return @() }
    $profiles = Get-ChildItem $userDataDir -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' }
    foreach ($p in $profiles) {
        foreach ($sub in 'Cache', 'Code Cache', 'GPUCache', 'Service Worker\CacheStorage') {
            $full = Join-Path $p.FullName $sub
            if (Test-Path $full) { $full }
        }
    }
    foreach ($sub in 'ShaderCache', 'GrShaderCache') {
        $full = Join-Path $userDataDir $sub
        if (Test-Path $full) { $full }
    }
}

function Get-CleanTargets {
    $L = $env:LOCALAPPDATA; $R = $env:APPDATA; $U = $env:USERPROFILE; $W = $env:WINDIR
    $t = @(
        @{ Name = 'File temporanei utente';          Paths = @($env:TEMP);                         Days = 2; Note = 'solo file più vecchi di 2 giorni' }
        @{ Name = 'File temporanei di Windows';      Paths = @("$W\Temp");                         Days = 2; Admin = $true }
        @{ Name = 'Cache download Windows Update';   Paths = @("$W\SoftwareDistribution\Download"); Days = 0; Admin = $true }
        @{ Name = 'Report errori / crash dump';      Paths = @("$L\CrashDumps", "$L\Microsoft\Windows\WER", "$env:ProgramData\Microsoft\Windows\WER\ReportArchive", "$env:ProgramData\Microsoft\Windows\WER\ReportQueue"); Days = 0 }
        @{ Name = 'Cache Chrome';                   Paths = @(Get-BrowserCachePaths "$L\Google\Chrome\User Data");          Days = 0; Note = 'chiudi Chrome prima' }
        @{ Name = 'Cache Edge';                     Paths = @(Get-BrowserCachePaths "$L\Microsoft\Edge\User Data");         Days = 0; Note = 'chiudi Edge prima' }
        @{ Name = 'Cache Brave';                    Paths = @(Get-BrowserCachePaths "$L\BraveSoftware\Brave-Browser\User Data"); Days = 0; Note = 'chiudi Brave prima' }
        @{ Name = 'Cache Firefox';                  Paths = @(Get-ChildItem "$L\Mozilla\Firefox\Profiles" -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'cache2' }); Days = 0; Note = 'chiudi Firefox prima' }
        @{ Name = 'Cache Discord';                  Paths = @("$R\discord\Cache", "$R\discord\Code Cache", "$R\discord\GPUCache"); Days = 0 }
        @{ Name = 'Cache Spotify';                  Paths = @("$L\Spotify\Storage", "$L\Spotify\Data");                     Days = 0 }
        @{ Name = 'Cache VS Code';                  Paths = @("$R\Code\Cache", "$R\Code\CachedData", "$R\Code\CachedExtensionVSIXs", "$R\Code\Code Cache", "$R\Code\GPUCache", "$R\Code\logs"); Days = 0 }
        @{ Name = 'Cache npm';                      Paths = @("$L\npm-cache\_cacache");                Days = 0; Note = 'si riscarica al bisogno' }
        @{ Name = 'Store pnpm';                     Paths = @("$L\pnpm\store", "$L\pnpm-cache");      Days = 0; Note = 'si riscarica al bisogno' }
        @{ Name = 'Cache Yarn';                     Paths = @("$L\Yarn\Cache");                        Days = 0 }
        @{ Name = 'Cache pip';                      Paths = @("$L\pip\Cache");                         Days = 0 }
        @{ Name = 'Cache NuGet (http)';             Paths = @("$L\NuGet\v3-cache", "$L\NuGet\Cache"); Days = 0 }
        @{ Name = 'Cache Gradle';                   Paths = @("$U\.gradle\caches");                    Days = 0 }
        @{ Name = 'Cache shader DirectX/NVIDIA/AMD'; Paths = @("$L\D3DSCache", "$L\NVIDIA\DXCache", "$L\NVIDIA\GLCache", "$L\AMD\DxCache", "$L\AMD\DxcCache"); Days = 0 }
    )
    $list = foreach ($x in $t) {
        [pscustomobject]@{
            Name  = $x.Name
            Paths = @($x.Paths | Where-Object { $_ -and (Test-Path -LiteralPath $_) })
            Days  = [int]$x.Days
            Admin = [bool]$x.Admin
            Note  = $x.Note
            Kind  = 'folder'
            Bytes = 0L; Files = 0L
        }
    }
    $list += [pscustomobject]@{ Name = 'Cestino'; Paths = @(); Days = 0; Admin = $false; Note = ''; Kind = 'recycle'; Bytes = 0L; Files = 0L }
    return $list
}

function Measure-CleanTargets($targets) {
    $i = 0
    foreach ($t in $targets) {
        $i++
        Write-Progress -Activity 'Calcolo spazio recuperabile' -Status $t.Name -PercentComplete ($i * 100 / $targets.Count)
        if ($t.Kind -eq 'recycle') {
            $r = Get-RecycleBinSize; $t.Bytes = $r.Bytes; $t.Files = $r.Files
        } else {
            foreach ($p in $t.Paths) {
                $r = [PuliDisco.Scanner]::DeleteContents($p, $t.Days, $false, $true)
                $t.Bytes += $r.Bytes; $t.Files += $r.Files
            }
        }
    }
    Write-Progress -Activity 'Calcolo spazio recuperabile' -Completed
    return $targets | Where-Object { $_.Bytes -gt 0 -or $_.Kind -eq 'recycle' }
}

function Get-Drives {
    Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
        [pscustomobject]@{
            Drive = $_.DeviceID; Label = $_.VolumeName
            Size = [int64]$_.Size; Free = [int64]$_.FreeSpace; Used = [int64]($_.Size - $_.FreeSpace)
        }
    }
}

$DevDirNames = @('node_modules', '.next', '.nuxt', '.turbo', '.parcel-cache', '.svelte-kit', '.angular', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache')
$DevSkip = @('AppData', '$Recycle.Bin', 'Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', 'OneDrive', 'anaconda3', 'miniconda3', 'win-unpacked', 'site-packages')

function Find-DevDirs([string]$root) {
    $all = [PuliDisco.Scanner]::FindDirs($root, $DevDirNames, $DevSkip)
    return @($all | Where-Object { $_.Bytes -ge 1MB })
}

function New-Report([string]$root, [string]$out) {
    $enc = { param($s) [System.Net.WebUtility]::HtmlEncode([string]$s) }
    Write-Host "1/4 dischi..." -ForegroundColor DarkGray
    $drives = @(Get-Drives)
    Write-Host "2/4 cartelle in $root ..." -ForegroundColor DarkGray
    $children = @([PuliDisco.Scanner]::Children($root) | Select-Object -First 25)
    $childTotal = ($children | Measure-Object Bytes -Sum).Sum
    Write-Host "3/4 file più grandi..." -ForegroundColor DarkGray
    $files = @([PuliDisco.Scanner]::TopFiles($root, 30, 100MB))
    Write-Host "4/4 spazio recuperabile e cartelle di sviluppo..." -ForegroundColor DarkGray
    $targets = @(Measure-CleanTargets (Get-CleanTargets) | Sort-Object Bytes -Descending)
    $dev = @(Find-DevDirs $root)

    $row = { param($label, $bytes, $total, $sub)
        $pct = if ($total) { [math]::Round(100 * $bytes / $total, 1) } else { 0 }
        "<tr><td class='n'>$(& $enc $label)$(if ($sub) { "<div class='sub'>$(& $enc $sub)</div>" })</td><td class='bar'><div style='width:$([math]::Min(100,$pct))%'></div></td><td class='s'>$(Format-Size $bytes)</td></tr>"
    }

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append(@"
<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>PuliDisco - report</title>
<style>
 body{font:14px/1.45 'Segoe UI',system-ui,sans-serif;background:#0f1115;color:#e6e6e6;margin:0;padding:32px;max-width:1100px}
 h1{font-weight:600;margin:0 0 4px} h2{font-weight:600;margin:36px 0 10px;font-size:17px;color:#9cc3ff}
 .muted{color:#8a8f98} table{width:100%;border-collapse:collapse} td{padding:6px 8px;border-bottom:1px solid #1e222a;vertical-align:middle}
 td.n{word-break:break-all} td.s{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;width:110px}
 td.bar{width:34%} td.bar div{height:10px;border-radius:5px;background:linear-gradient(90deg,#3d7cff,#8fb4ff);min-width:2px}
 .sub{color:#8a8f98;font-size:12px} .drive{display:flex;gap:16px;align-items:center;margin:8px 0}
 .meter{flex:1;height:18px;background:#1e222a;border-radius:9px;overflow:hidden} .meter div{height:100%}
 .total{font-size:22px;font-weight:600;color:#7ee2a8}
</style></head><body>
<h1>PuliDisco</h1><div class="muted">Report del $(Get-Date -Format 'dd/MM/yyyy HH:mm') &middot; analizzato: $(& $enc $root)</div>
<h2>Dischi</h2>
"@)
    foreach ($d in $drives) {
        $f = if ($d.Size) { $d.Used / $d.Size } else { 0 }
        $c = if ($f -gt 0.9) { '#ff5d5d' } elseif ($f -gt 0.75) { '#ffc24b' } else { '#4cd486' }
        [void]$sb.Append("<div class='drive'><b style='width:30px'>$($d.Drive)</b><div class='meter'><div style='width:$([math]::Round($f*100,1))%;background:$c'></div></div><span>$(Format-Size $d.Used) usati su $(Format-Size $d.Size) &middot; <b>$(Format-Size $d.Free) liberi</b></span></div>")
    }

    $recl = ($targets | Measure-Object Bytes -Sum).Sum + ($dev | Measure-Object Bytes -Sum).Sum
    [void]$sb.Append("<h2>Spazio recuperabile</h2><div class='total'>$(Format-Size $recl)</div><div class='muted'>cache + temp + cestino + cartelle di sviluppo rigenerabili</div><table>")
    $max = ($targets | Measure-Object Bytes -Maximum).Maximum
    foreach ($t in $targets) { [void]$sb.Append((& $row $t.Name $t.Bytes $max ($t.Paths -join ' | '))) }
    [void]$sb.Append('</table>')

    [void]$sb.Append("<h2>Cosa occupa spazio in $(& $enc $root) &middot; $(Format-Size $childTotal)</h2><table>")
    foreach ($e in $children) { [void]$sb.Append((& $row ($(if ($e.IsDir) { '📁 ' } else { '📄 ' }) + $e.Name) $e.Bytes $childTotal $(if ($e.IsDir) { "{0:N0} file" -f $e.Files }))) }
    [void]$sb.Append('</table>')

    if ($files.Count) {
        [void]$sb.Append("<h2>File più grandi (&gt; 100 MB)</h2><table>")
        $max = $files[0].Bytes
        foreach ($f in $files) { [void]$sb.Append((& $row $f.Name $f.Bytes $max ("{0}  ·  modificato {1:dd/MM/yyyy}" -f $f.FullPath, $f.Modified))) }
        [void]$sb.Append('</table>')
    }
    if ($dev.Count) {
        [void]$sb.Append("<h2>Cartelle di sviluppo rigenerabili</h2><table>")
        $max = $dev[0].Bytes
        foreach ($d in $dev | Select-Object -First 40) { [void]$sb.Append((& $row $d.FullPath $d.Bytes $max ("progetto toccato {0} giorni fa" -f [int]((Get-Date) - $d.Modified).TotalDays))) }
        [void]$sb.Append('</table>')
    }
    [void]$sb.Append('<p class="muted" style="margin-top:40px">Per pulire: esegui PuliDisco.ps1 e scegli le voci dal menu.</p></body></html>')
    [IO.File]::WriteAllText($out, $sb.ToString(), (New-Object System.Text.UTF8Encoding $true))
    return $out
}

# ---------------------------------------------------------------------------
#  Lumen: ciclo di comandi JSON (una richiesta per riga su stdin)
# ---------------------------------------------------------------------------
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function ConvertTo-Item($e) { @{ path = $e.FullPath; name = $e.Name; bytes = [long]$e.Bytes; files = [long]$e.Files; isDir = [bool]$e.IsDir; modified = $e.Modified.ToString('o') } }

function Handle-Disk($cmd, $a) {
  switch ($cmd) {
    'ping'     { 'pong' }
    'admin'    { $IsAdmin }
    'drives'   { , @(Get-Drives | ForEach-Object { @{ drive = $_.Drive; label = $_.Label; size = $_.Size; free = $_.Free; used = $_.Used } }) }
    'children' { , @([PuliDisco.Scanner]::Children([string]$a.path) | Select-Object -First 80 | ForEach-Object { ConvertTo-Item $_ }) }
    'topFiles' { , @([PuliDisco.Scanner]::TopFiles([string]$a.path, [int]$a.count, [long]$a.minBytes) | ForEach-Object { ConvertTo-Item $_ }) }
    'targets'  {
      , @(Measure-CleanTargets (Get-CleanTargets) | ForEach-Object {
        @{ name = $_.Name; bytes = [long]$_.Bytes; files = [long]$_.Files; admin = $_.Admin; blocked = ($_.Admin -and -not $IsAdmin); note = $_.Note; kind = $_.Kind; paths = @($_.Paths) } })
    }
    'clean'    {
      $want = @($a.names)
      $res = @()
      foreach ($t in Get-CleanTargets) {
        if ($want -notcontains $t.Name) { continue }
        if ($t.Admin -and -not $IsAdmin) { $res += @{ name = $t.Name; bytes = 0L; skipped = 'admin' }; continue }
        if ($t.Kind -eq 'recycle') {
          $r = Get-RecycleBinSize
          try { Clear-RecycleBin -Force -ErrorAction Stop; $res += @{ name = $t.Name; bytes = [long]$r.Bytes } } catch { $res += @{ name = $t.Name; bytes = 0L; error = "$_" } }
          continue
        }
        $b = 0L; $failed = 0L
        foreach ($p in $t.Paths) { $r = [PuliDisco.Scanner]::DeleteContents($p, $t.Days, $false, $false); $b += $r.Bytes; $failed += $r.Failed }
        $res += @{ name = $t.Name; bytes = $b; failed = $failed }
      }
      , $res
    }
    'devDirs'  {
      , @(Find-DevDirs ([string]$a.path) | ForEach-Object { $i = ConvertTo-Item $_; $i.ageDays = [int]((Get-Date) - $_.Modified).TotalDays; $i })
    }
    'devClean' {
      $res = @()
      foreach ($p in @($a.paths)) {
        # sicurezza: solo cartelle con un nome della lista (node_modules, .next, __pycache__…)
        if (-not ($DevDirNames -contains (Split-Path $p -Leaf)) -or -not (Test-Path -LiteralPath $p -PathType Container)) { continue }
        $r = [PuliDisco.Scanner]::DeleteContents($p, 0, $true, $false)
        $res += @{ path = $p; bytes = [long]$r.Bytes; failed = [long]$r.Failed }
      }
      , $res
    }
    'report'   { New-Report ([string]$a.path) ([string]$a.out) }
    default    { throw "comando sconosciuto: $cmd" }
  }
}

[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  $id = $null
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    $data = Handle-Disk $req.cmd $req.args
    $out = @{ id = $id; ok = $true; data = $data }
  } catch { $out = @{ id = $id; ok = $false; error = "$($_.Exception.Message)" } }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $out -Compress -Depth 6))
}
