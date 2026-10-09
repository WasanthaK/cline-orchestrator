using System.Diagnostics;
using System.Runtime.InteropServices;

internal static class Program
{
    private const int ServiceWin32OwnProcess = 0x10;
    private const int ServiceStartPending = 2;
    private const int ServiceStopPending = 3;
    private const int ServiceRunning = 4;
    private const int ServiceStopped = 1;
    private const int ServiceAcceptStop = 1;
    private const int ServiceControlStop = 1;
    private static readonly ManualResetEventSlim StopRequested = new(false);
    private static readonly ServiceMainDelegate MainDelegate = ServiceMain;
    private static readonly ServiceHandlerDelegate HandlerDelegate = HandleControl;
    private static IntPtr statusHandle;
    private static Process? child;

    private delegate void ServiceMainDelegate(uint argc, IntPtr argv);
    private delegate uint ServiceHandlerDelegate(uint control, uint eventType, IntPtr eventData, IntPtr context);

    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceTableEntry
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string ServiceName;
        public ServiceMainDelegate ServiceProc;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceStatus
    {
        public int ServiceType;
        public int CurrentState;
        public int ControlsAccepted;
        public int Win32ExitCode;
        public int ServiceSpecificExitCode;
        public int CheckPoint;
        public int WaitHint;
    }

    [DllImport("advapi32.dll", EntryPoint = "StartServiceCtrlDispatcherW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool StartDispatcher([In] ServiceTableEntry[] table);

    [DllImport("advapi32.dll", EntryPoint = "RegisterServiceCtrlHandlerExW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr RegisterHandler(string name, ServiceHandlerDelegate handler, IntPtr context);

    [DllImport("advapi32.dll", EntryPoint = "SetServiceStatus", SetLastError = true)]
    private static extern bool ReportStatus(IntPtr handle, ref ServiceStatus status);

    private static int Main()
    {
        if (!OperatingSystem.IsWindows()) return 1;
        var table = new[] {
            new ServiceTableEntry { ServiceName = "cline-orchestrator", ServiceProc = MainDelegate },
            new ServiceTableEntry { ServiceName = "", ServiceProc = MainDelegate }
        };
        return StartDispatcher(table) ? 0 : Marshal.GetLastWin32Error();
    }

    private static void SetStatus(int state, int error = 0)
    {
        var status = new ServiceStatus {
            ServiceType = ServiceWin32OwnProcess, CurrentState = state,
            ControlsAccepted = state == ServiceRunning ? ServiceAcceptStop : 0,
            Win32ExitCode = error, WaitHint = state is ServiceStartPending or ServiceStopPending ? 30000 : 0
        };
        if (statusHandle != IntPtr.Zero) ReportStatus(statusHandle, ref status);
    }

    private static uint HandleControl(uint control, uint eventType, IntPtr eventData, IntPtr context)
    {
        if (control == ServiceControlStop) StopRequested.Set();
        return 0;
    }

    private static void ServiceMain(uint argc, IntPtr argv)
    {
        statusHandle = RegisterHandler("cline-orchestrator", HandlerDelegate, IntPtr.Zero);
        if (statusHandle == IntPtr.Zero) return;
        SetStatus(ServiceStartPending);
        try
        {
            string node = RequireAbsoluteEnvironment("ORCH_SERVICE_NODE");
            string entry = RequireAbsoluteEnvironment("ORCH_SERVICE_ENTRY");
            string workspace = RequireAbsoluteEnvironment("ORCH_SERVICE_WORKSPACE");
            if (!File.Exists(node) || !File.Exists(entry) || !Directory.Exists(workspace))
                throw new InvalidOperationException("Service configuration is incomplete");
            var info = new ProcessStartInfo(node) {
                UseShellExecute = false, WorkingDirectory = workspace, CreateNoWindow = true
            };
            info.ArgumentList.Add(entry);
            info.ArgumentList.Add("daemon");
            info.ArgumentList.Add(workspace);
            info.Environment["ORCH_DAEMON_HOST"] = "127.0.0.1";
            info.Environment["ORCH_AUTO_APPROVE_COMMANDS"] = "false";
            info.Environment["ORCH_AUTO_APPROVE_EDITS"] = "false";
            child = Process.Start(info) ?? throw new InvalidOperationException("Daemon failed to start");
            SetStatus(ServiceRunning);
            while (!StopRequested.Wait(250) && !child.HasExited) { }
            SetStatus(ServiceStopPending);
            if (!child.HasExited) {
                child.Kill(entireProcessTree: true);
                child.WaitForExit(10000);
            }
            SetStatus(ServiceStopped, StopRequested.IsSet ? 0 : 1);
        }
        catch {
            SetStatus(ServiceStopped, 1);
        }
        finally { child?.Dispose(); }
    }

    private static string RequireAbsoluteEnvironment(string key)
    {
        var value = Environment.GetEnvironmentVariable(key);
        if (string.IsNullOrWhiteSpace(value) || !Path.IsPathFullyQualified(value)
            || value.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0)
            throw new InvalidOperationException("Service configuration is invalid");
        return value;
    }
}
