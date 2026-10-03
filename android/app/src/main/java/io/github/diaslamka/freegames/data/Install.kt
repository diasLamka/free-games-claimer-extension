package io.github.diaslamka.freegames.data

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import java.io.File

/**
 * L'installation de l'APK telecharge (1.20.0), par le programme d'installation
 * du systeme (PackageInstaller) : Android reverifie la signature, et refuse un
 * APK qui n'est pas signe par la meme cle que l'appli installee.
 *
 *  - Android 12 et plus, quand l'appli est l'installateur d'origine de la version en place ET declare
 *    UPDATE_PACKAGES_WITHOUT_USER_ACTION (manquante jusqu'a 1.25.0 : la confirmation revenait toujours) :
 *    le systeme peut mettre a jour SANS demander (USER_ACTION_NOT_REQUIRED). La premiere mise a jour faite
 *    depuis l'appli demande donc encore ; les suivantes, non. Voir [silence].
 *  - Sinon, il affiche sa fenetre « Mettre a jour cette appli ? » : un geste.
 *
 * Il faut que l'utilisateur ait autorise, UNE fois, cette appli a installer des
 * applis (reglage « Installer des applis inconnues »). Rien ne s'installe en
 * arriere-plan : l'appel vient de l'ecran des reglages.
 */
object Install {
    const val ACTION = "io.github.diaslamka.freegames.INSTALL_RESULT"

    /** L'appli est a l'ecran (1.25.0) : seule alors une fenetre du systeme peut s'ouvrir d'elle-meme. */
    @Volatile
    var visible: Boolean = false

    fun allowed(context: Context): Boolean = context.packageManager.canRequestPackageInstalls()

    /** Ce qu'Android fera de la PROCHAINE mise a jour (1.26.0). */
    enum class Silence {
        /** Avant Android 12 : le systeme demande toujours. */
        ASKS_ALWAYS,

        /** L'autorisation « Installer des applis inconnues » n'est pas donnee. */
        NEEDS_PERMISSION,

        /** Installee par autre chose que cette appli (navigateur, gestionnaire de fichiers) : UNE confirmation, puis plus. */
        FIRST_TIME,

        /** Cette appli est l'installateur d'origine : Android peut mettre a jour sans demander. */
        SILENT,
    }

    /**
     * Android 12+ saute la confirmation quand l'installateur d'origine de la version en place est celui qui
     * installe la suivante (et que la permission UPDATE_PACKAGES_WITHOUT_USER_ACTION est declaree). L'installateur
     * d'origine devient cette appli des qu'elle a installe UNE mise a jour elle-meme.
     */
    fun silence(sdk: Int, allowed: Boolean, installer: String?, self: String): Silence = when {
        sdk < 31 -> Silence.ASKS_ALWAYS
        !allowed -> Silence.NEEDS_PERMISSION
        installer == self -> Silence.SILENT
        else -> Silence.FIRST_TIME
    }

    /** Qui a installe cette appli en dernier (le paquet de l'installateur), ou null quand Android ne le dit pas. */
    fun installerOfRecord(context: Context): String? = try {
        if (Build.VERSION.SDK_INT >= 30) context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName
        else @Suppress("DEPRECATION") context.packageManager.getInstallerPackageName(context.packageName)
    } catch (_: Exception) {
        null
    }

    fun silence(context: Context): Silence = silence(Build.VERSION.SDK_INT, allowed(context), installerOfRecord(context), context.packageName)

    /** L'ecran du systeme ou l'utilisateur autorise cette appli a installer. */
    fun allowIntent(context: Context): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /**
     * Cet APK est-il bien une version de CETTE appli ? Meme nom de paquet, la
     * version annoncee, et -- quand le systeme sait les lire -- les memes
     * certificats de signature que l'appli installee.
     */
    fun sameApp(context: Context, file: File, version: String): Boolean = try {
        val pm = context.packageManager
        @Suppress("DEPRECATION")
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val archive = pm.getPackageArchiveInfo(file.path, flags)
        if (archive == null || archive.packageName != context.packageName || archive.versionName != version) {
            false
        } else if (Build.VERSION.SDK_INT >= 28) {
            val theirs = archive.signingInfo?.apkContentsSigners?.map { it.toByteArray().toList() }?.toSet()
            val mine = pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
                .signingInfo?.apkContentsSigners?.map { it.toByteArray().toList() }?.toSet()
            // Illisible d'un cote : le systeme tranchera a l'installation. Lisible des deux : identiques, ou rien.
            theirs == null || mine == null || theirs.isEmpty() || mine.isEmpty() || theirs == mine
        } else {
            true
        }
    } catch (_: Exception) {
        false
    }

    /** Passe l'APK au systeme. Le resultat arrive a [UpdateReceiver]. */
    fun start(context: Context, file: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(context.packageName)
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            file.inputStream().use { input ->
                session.openWrite("app.apk", 0, file.length()).use { out ->
                    input.copyTo(out)
                    session.fsync(out)
                }
            }
            val intent = Intent(context, UpdateReceiver::class.java).setAction(ACTION).setPackage(context.packageName)
            val pending = PendingIntent.getBroadcast(
                context, id, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0),
            )
            session.commit(pending.intentSender)
        }
    }
}

/** Ce que le systeme repond a l'installation : demander un geste, reussir, ou echouer. */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Install.ACTION) return
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = if (Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT) as? Intent
                }
                /* Appli a l'ecran : la fenetre du systeme s'ouvre. En fond, Android interdit d'ouvrir une fenetre
                   de nulle part (mise a jour automatique, 1.25.0) : une notification la porte, un toucher l'ouvre. */
                if (confirm != null) {
                    if (Install.visible) runCatching { context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                    else io.github.diaslamka.freegames.notify.Notifier.updateConfirm(context, confirm)
                }
            }
            PackageInstaller.STATUS_SUCCESS -> AppUpdate.status.value = AppUpdate.Status.Idle
            else -> AppUpdate.status.value = AppUpdate.Status.Failed(
                AppUpdate.Reason.INSTALL,
                intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)?.take(120),
            )
        }
    }
}
