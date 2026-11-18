"use client"

import { useTranslations, useLocale } from "next-intl"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import {
  Users,
  Loader2,
  Search,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Pencil,
  MailPlus,
  UserPlus,
  KeyRound,
} from "lucide-react"
import { useState, useEffect, useCallback } from "react"
import { ROLES, Role } from "@/lib/permissions"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type RoleWithoutEmperor = Exclude<Role, typeof ROLES.EMPEROR>

interface ManagedUser {
  id: string
  name: string | null
  username: string | null
  email: string | null
  image: string | null
  role: string | null
  emailLimit: number | null
  activeEmailCount: number
}

const PAGE_SIZE = 10

export function UserManagementPanel() {
  const t = useTranslations("profile.userManagement")
  const tCard = useTranslations("profile.card")
  const tPromote = useTranslations("profile.promote")
  const locale = useLocale()
  const router = useRouter()
  const { data: session } = useSession()
  const currentUserId = session?.user?.id
  const { toast } = useToast()

  const [users, setUsers] = useState<ManagedUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)

  // 新建用户对话框
  const [createOpen, setCreateOpen] = useState(false)
  const [createUsername, setCreateUsername] = useState("")
  const [createPassword, setCreatePassword] = useState("")
  const [createRole, setCreateRole] = useState<RoleWithoutEmperor>(ROLES.CIVILIAN)
  const [createEmailLimit, setCreateEmailLimit] = useState("")
  const [creating, setCreating] = useState(false)

  // 编辑用户对话框
  const [editUser, setEditUser] = useState<ManagedUser | null>(null)
  const [editUsername, setEditUsername] = useState("")
  const [editPassword, setEditPassword] = useState("")
  const [editRole, setEditRole] = useState<RoleWithoutEmperor>(ROLES.CIVILIAN)
  const [editEmailLimit, setEditEmailLimit] = useState("")
  const [saving, setSaving] = useState(false)

  // 删除确认
  const [userToDelete, setUserToDelete] = useState<ManagedUser | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 特殊访问密钥
  const [accessKeyConfigured, setAccessKeyConfigured] = useState<boolean | null>(null)
  const [accessKeyInput, setAccessKeyInput] = useState("")
  const [accessKeySaving, setAccessKeySaving] = useState(false)

  const roleNames = {
    [ROLES.EMPEROR]: tCard("roles.EMPEROR"),
    [ROLES.DUKE]: tCard("roles.DUKE"),
    [ROLES.KNIGHT]: tCard("roles.KNIGHT"),
    [ROLES.CIVILIAN]: tCard("roles.CIVILIAN"),
  } as const

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: PAGE_SIZE.toString(),
      })
      if (search.trim()) {
        params.set("search", search.trim())
      }
      const res = await fetch(`/api/roles/users?${params}`)
      if (!res.ok) throw new Error("Failed to fetch")
      const data = (await res.json()) as {
        users: ManagedUser[]
        total: number
      }
      setUsers(data.users)
      setTotal(data.total)
    } catch {
      toast({ title: t("loadFailed"), variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [page, search, t, toast])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  useEffect(() => {
    setPage(1)
  }, [search])

  const fetchAccessKeyStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/access-key")
      if (res.ok) {
        const data = (await res.json()) as { configured: boolean }
        setAccessKeyConfigured(data.configured)
      }
    } catch {
      // 状态读取失败不阻塞面板
    }
  }, [])

  useEffect(() => {
    fetchAccessKeyStatus()
  }, [fetchAccessKeyStatus])

  const parseLimitInput = (value: string): number | null | undefined => {
    const trimmed = value.trim()
    if (trimmed === "") return null
    const num = Number(trimmed)
    if (!Number.isInteger(num) || num < 1 || num > 100000) return undefined
    return num
  }

  const handleCreate = async () => {
    const limit = parseLimitInput(createEmailLimit)
    if (limit === undefined) {
      toast({ title: t("invalidEmailLimit"), variant: "destructive" })
      return
    }
    setCreating(true)
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: createUsername,
          password: createPassword,
          role: createRole,
          emailLimit: limit,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error || t("createFailed"))
      }
      toast({ title: t("createSuccess") })
      setCreateOpen(false)
      setCreateUsername("")
      setCreatePassword("")
      setCreateRole(ROLES.CIVILIAN)
      setCreateEmailLimit("")
      await fetchUsers()
    } catch (error) {
      toast({
        title: t("createFailed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      })
    } finally {
      setCreating(false)
    }
  }

  const openEdit = (user: ManagedUser) => {
    setEditUser(user)
    setEditUsername(user.username || "")
    setEditPassword("")
    setEditRole((user.role as RoleWithoutEmperor) || ROLES.CIVILIAN)
    setEditEmailLimit(user.emailLimit != null ? user.emailLimit.toString() : "")
  }

  const handleEditSave = async () => {
    if (!editUser) return
    const limit = parseLimitInput(editEmailLimit)
    if (limit === undefined) {
      toast({ title: t("invalidEmailLimit"), variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        username: editUsername,
        role: editRole,
        emailLimit: limit,
      }
      if (editPassword) {
        payload.password = editPassword
      }
      const res = await fetch(`/api/admin/users/${editUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error || t("updateFailed"))
      }
      toast({ title: t("updateSuccess") })
      setEditUser(null)
      await fetchUsers()
    } catch (error) {
      toast({
        title: t("updateFailed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (user: ManagedUser) => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error || t("deleteFailed"))
      }
      toast({ title: tPromote("deleteSuccess") })
      setUserToDelete(null)
      if (users.length === 1 && page > 1) {
        setPage((p) => p - 1)
      } else {
        await fetchUsers()
      }
    } catch (error) {
      toast({
        title: t("deleteFailed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      })
    } finally {
      setDeleting(false)
    }
  }

  const handleAccessKeySave = async () => {
    if (accessKeyInput.length < 12) {
      toast({ title: t("accessKeyTooShort"), variant: "destructive" })
      return
    }
    setAccessKeySaving(true)
    try {
      const res = await fetch("/api/admin/access-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: accessKeyInput }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error || t("accessKeySaveFailed"))
      }
      toast({ title: t("accessKeySaved") })
      setAccessKeyInput("")
      setAccessKeyConfigured(true)
    } catch (error) {
      toast({
        title: t("accessKeySaveFailed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      })
    } finally {
      setAccessKeySaving(false)
    }
  }

  const handleAccessKeyClear = async () => {
    setAccessKeySaving(true)
    try {
      const res = await fetch("/api/admin/access-key", { method: "DELETE" })
      if (!res.ok) throw new Error(t("accessKeyClearFailed"))
      toast({ title: t("accessKeyCleared") })
      setAccessKeyConfigured(false)
    } catch (error) {
      toast({
        title: t("accessKeyClearFailed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      })
    } finally {
      setAccessKeySaving(false)
    }
  }

  const roleSelect = (
    value: RoleWithoutEmperor,
    onChange: (role: RoleWithoutEmperor) => void
  ) => (
    <Select value={value} onValueChange={(v) => onChange(v as RoleWithoutEmperor)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ROLES.DUKE}>{roleNames[ROLES.DUKE]}</SelectItem>
        <SelectItem value={ROLES.KNIGHT}>{roleNames[ROLES.KNIGHT]}</SelectItem>
        <SelectItem value={ROLES.CIVILIAN}>{roleNames[ROLES.CIVILIAN]}</SelectItem>
      </SelectContent>
    </Select>
  )

  return (
    <div className="bg-background rounded-lg border-2 border-primary/20 p-6">
      <div className="flex items-center gap-2 mb-6">
        <Users className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <span className="text-sm text-muted-foreground ml-auto">
          {tPromote("totalUsers", { count: total })}
        </span>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
          <UserPlus className="w-4 h-4" />
          {t("createUser")}
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tPromote("searchPlaceholder")}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <span className="ml-2 text-muted-foreground">{tPromote("loading")}</span>
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">{tPromote("noUsers")}</div>
      ) : (
        <>
          <div className="space-y-2">
            {users.map((user) => {
              const isEmperor = user.role === ROLES.EMPEROR
              const isSelf = user.id === currentUserId
              return (
                <div
                  key={user.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {user.username || user.name || "—"}
                      <span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                        {roleNames[(user.role as Role) || ROLES.CIVILIAN]}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {t("emailUsage", {
                        count: user.activeEmailCount,
                        limit: user.emailLimit != null ? user.emailLimit : t("defaultLimit"),
                      })}
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => router.push(`/${locale}/admin/space/${user.id}`)}
                  >
                    <MailPlus className="w-4 h-4" />
                    {t("enterSpace")}
                  </Button>
                  {!isEmperor && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(user)}
                      title={t("edit")}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                  )}
                  {!isEmperor && !isSelf && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setUserToDelete(user)}
                      title={tPromote("deleteUser")}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              )
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                {tPromote("prevPage")}
              </Button>
              <span className="text-sm text-muted-foreground">
                {tPromote("pageInfo", { current: page, total: totalPages })}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                {tPromote("nextPage")}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </>
      )}

      {/* 特殊访问密钥 */}
      <div className="mt-6 space-y-3 rounded-lg border border-dashed border-primary/40 p-4">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-primary">{t("accessKeyTitle")}</h3>
          <span className="text-xs text-muted-foreground ml-auto">
            {accessKeyConfigured === null
              ? tPromote("loading")
              : accessKeyConfigured
                ? t("accessKeyConfigured")
                : t("accessKeyNotConfigured")}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t("accessKeyDescription")}</p>
        <div className="flex gap-2">
          <Input
            type="password"
            value={accessKeyInput}
            onChange={(e) => setAccessKeyInput(e.target.value)}
            placeholder={t("accessKeyPlaceholder")}
          />
          <Button onClick={handleAccessKeySave} disabled={accessKeySaving}>
            {accessKeySaving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("accessKeySave")}
          </Button>
          {accessKeyConfigured && (
            <Button
              variant="outline"
              onClick={handleAccessKeyClear}
              disabled={accessKeySaving}
            >
              {t("accessKeyClear")}
            </Button>
          )}
        </div>
      </div>

      {/* 新建用户 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createUser")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("username")}</Label>
              <Input
                value={createUsername}
                onChange={(e) => setCreateUsername(e.target.value)}
                placeholder={t("usernamePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("password")}</Label>
              <Input
                type="password"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                placeholder={t("passwordPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("role")}</Label>
              {roleSelect(createRole, setCreateRole)}
            </div>
            <div className="space-y-2">
              <Label>{t("emailLimit")}</Label>
              <Input
                type="number"
                min="1"
                max="100000"
                value={createEmailLimit}
                onChange={(e) => setCreateEmailLimit(e.target.value)}
                placeholder={t("emailLimitPlaceholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {tPromote("cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑用户 */}
      <Dialog open={!!editUser} onOpenChange={(open) => { if (!open) setEditUser(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editUser")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("username")}</Label>
              <Input
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("newPassword")}</Label>
              <Input
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                placeholder={t("newPasswordPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("role")}</Label>
              {roleSelect(editRole, setEditRole)}
            </div>
            <div className="space-y-2">
              <Label>{t("emailLimit")}</Label>
              <Input
                type="number"
                min="1"
                max="100000"
                value={editEmailLimit}
                onChange={(e) => setEditEmailLimit(e.target.value)}
                placeholder={t("emailLimitPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{t("emailLimitHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>
              {tPromote("cancel")}
            </Button>
            <Button onClick={handleEditSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog
        open={!!userToDelete}
        onOpenChange={(open) => {
          if (!open && !deleting) setUserToDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tPromote("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tPromote("deleteConfirm", {
                name: userToDelete?.username || userToDelete?.name || userToDelete?.email || "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{tPromote("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault()
                if (userToDelete) handleDelete(userToDelete)
              }}
            >
              {deleting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                tPromote("deleteConfirmButton")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
