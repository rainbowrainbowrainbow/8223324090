using System;
using System.Linq;
using System.Runtime.InteropServices;

// Read-only COM prefix declarations. Unused slots preserve the native vtable.
// Native raw-tree traversal does not move the pointer or activate the window.
namespace ViberObserver {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [ComImport, Guid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAutomation {
        void CompareElements(IntPtr a, IntPtr b, out int same);
        void CompareRuntimeIds(IntPtr a, IntPtr b, out int same);
        void GetRootElement(out IElement element);
        void ElementFromHandle(IntPtr hwnd, out IElement element);
        void ElementFromPoint(Point point, out IElement element);
        void UnusedGetFocusedElement();
        void UnusedGetRootElementBuildCache();
        void UnusedElementFromHandleBuildCache();
        void UnusedElementFromPointBuildCache();
        void UnusedGetFocusedElementBuildCache();
        void UnusedCreateTreeWalker();
        void UnusedGetControlViewWalker();
        void UnusedGetContentViewWalker();
        void GetRawViewWalker(out IWalker walker);
    }
    [ComImport, Guid("4042c624-389c-4afc-a630-9df854a541fc"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IWalker {
        void GetParentElement(IElement element, out IElement parent);
        void GetFirstChildElement(IElement element, out IElement child);
        void GetLastChildElement(IElement element, out IElement child);
        void GetNextSiblingElement(IElement element, out IElement sibling);
    }
    [ComImport, Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IElement {
        void UnusedSetFocus();
        void GetRuntimeId([MarshalAs(UnmanagedType.SafeArray, SafeArraySubType=VarEnum.VT_I4)] out int[] id);
        void UnusedFindFirst();
        void UnusedFindAll();
        void UnusedFindFirstBuildCache();
        void UnusedFindAllBuildCache();
        void UnusedBuildUpdatedCache();
        void GetCurrentPropertyValue(int propertyId, [MarshalAs(UnmanagedType.Struct)] out object value);
    }
    public sealed class LegacyResult {
        public string Status;
        public bool? SameProcess;
        public bool? SameRuntimeId;
        public object Name;
        public object Value;
    }
    public static class LegacyProbe {
        public static bool ValidPath(int[] path) {
            return path != null && path.Length <= 16 && path.All(index => index >= 0 && index < 2000);
        }
        public static LegacyResult ReadNative(IntPtr hwnd, int[] path, int[] expectedRuntimeId, int expectedProcessId) {
            if (!ValidPath(path) || expectedRuntimeId == null || expectedRuntimeId.Length == 0)
                return new LegacyResult { Status="invalid_target" };
            IAutomation automation = null;
            IElement element = null;
            IWalker walker = null;
            try {
                automation = (IAutomation)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("ff48dba4-60ef-4201-aa87-54103eef594e")));
                automation.ElementFromHandle(hwnd, out element);
                automation.GetRawViewWalker(out walker);
                foreach (int index in path) {
                    IElement next;
                    walker.GetFirstChildElement(element, out next);
                    Marshal.ReleaseComObject(element);
                    element = next;
                    for (int sibling = 0; sibling < index && element != null; sibling++) {
                        walker.GetNextSiblingElement(element, out next);
                        Marshal.ReleaseComObject(element);
                        element = next;
                    }
                    if (element == null) return new LegacyResult { Status="tree_target_missing" };
                }
                int[] actual;
                element.GetRuntimeId(out actual);
                object process;
                element.GetCurrentPropertyValue(30002, out process);
                bool sameProcess = process is int && (int)process == expectedProcessId;
                bool sameRuntime = actual != null && actual.SequenceEqual(expectedRuntimeId);
                if (!sameProcess || !sameRuntime)
                    return new LegacyResult { Status="tree_target_mismatch", SameProcess=sameProcess, SameRuntimeId=sameRuntime };
                object password;
                element.GetCurrentPropertyValue(30019, out password);
                if (password is bool && (bool)password)
                    return new LegacyResult { Status="password_skipped", SameProcess=true, SameRuntimeId=true };
                object available;
                element.GetCurrentPropertyValue(30090, out available);
                if (!(available is bool) || !(bool)available)
                    return new LegacyResult { Status="unsupported", SameProcess=true, SameRuntimeId=true };
                object name, value;
                element.GetCurrentPropertyValue(30092, out name);
                element.GetCurrentPropertyValue(30093, out value);
                return new LegacyResult { Status="read", SameProcess=true, SameRuntimeId=true, Name=name, Value=value };
            } catch {
                // Provider exception text can contain private UI data.
                return new LegacyResult { Status="read_error" };
            } finally {
                if (element != null) Marshal.ReleaseComObject(element);
                if (walker != null) Marshal.ReleaseComObject(walker);
                if (automation != null) Marshal.ReleaseComObject(automation);
            }
        }
    }
}
