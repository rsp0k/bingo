"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { UserLayout } from "@/components/layout/user-layout"
import { useAuth } from "@/hooks/use-auth"
import { User, Mail, Phone, DollarSign } from "lucide-react"

export default function ProfilePage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login")
    }
  }, [user, loading, router])

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Carregando...</div>
  }

  if (!user) {
    return null
  }

  return (
    <UserLayout>
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <User className="h-8 w-8 text-blue-600" />
            </div>
            <CardTitle className="text-2xl">Meu Perfil</CardTitle>
            <CardDescription>Informações da sua conta</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
                  <User className="h-4 w-4" />
                  Nome Completo
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">{user.name}</div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
                  <Mail className="h-4 w-4" />
                  Email
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">{user.email}</div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
                  <Phone className="h-4 w-4" />
                  Telefone
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">{user.phone}</div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
                  <DollarSign className="h-4 w-4" />
                  Saldo Atual
                </div>
                <div className="p-3 bg-green-50 rounded-lg text-green-700 font-medium">
                  R$ {user.balance.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-medium mb-4">Estatísticas</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="p-4 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">R$ {user.totalDeposited.toFixed(2)}</div>
                  <div className="text-sm text-blue-600">Total Depositado</div>
                </div>
                <div className="p-4 bg-purple-50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">R$ {user.totalWithdrawn.toFixed(2)}</div>
                  <div className="text-sm text-purple-600">Total Sacado</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </UserLayout>
  )
}
