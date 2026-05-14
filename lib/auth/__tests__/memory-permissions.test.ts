import { MemoryPermissionProvider } from "@/lib/auth/memory/permissions";
import { runPermissionsContract } from "./permissions-contract";

runPermissionsContract("MemoryPermissionProvider", async () => new MemoryPermissionProvider());
