package io.github.diaslamka.freegames.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * La phrase de passe de la sauvegarde automatique (1.28.0), chiffree par une cle du Keystore Android -- comme le jeton de la mise
 * a jour et le secret du relais. Le travail de fond a besoin de la phrase pour chiffrer sans personne devant l'ecran ; la cle, elle,
 * ne quitte pas le telephone : ce fichier n'est lisible que par cette appli, sur ce telephone.
 *
 * Pas dans l'etat, pas dans une sauvegarde, jamais dans le journal. Sur un nouveau telephone, la phrase se retape (c'est elle,
 * dans la tete de l'utilisateur, qui ouvre la sauvegarde) : rien d'ici n'est a restaurer.
 */
object BackupSecret {
    private const val ALIAS = "fgc-sauvegarde"
    private const val FILE = "sauvegarde.bin"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return g.generateKey()
    }

    fun save(context: Context, passphrase: String): Boolean {
        if (!BackupVault.acceptable(passphrase) || passphrase.length > 512) return false
        return try {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, key())
            val out = c.iv + c.doFinal(passphrase.toByteArray(Charsets.UTF_8))
            val f = File(context.filesDir, FILE)
            val tmp = File(context.filesDir, "$FILE.tmp")
            tmp.writeBytes(out)
            if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
            true
        } catch (_: Exception) {
            false
        }
    }

    fun load(context: Context): String? = try {
        val all = File(context.filesDir, FILE).takeIf { it.exists() }?.readBytes()
        if (all == null || all.size < 12 + 16) {
            null
        } else {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, all.copyOfRange(0, 12)))
            String(c.doFinal(all.copyOfRange(12, all.size)), Charsets.UTF_8).takeIf { BackupVault.acceptable(it) }
        }
    } catch (_: Exception) {
        null
    }

    fun present(context: Context): Boolean = File(context.filesDir, FILE).exists()

    fun clear(context: Context) {
        File(context.filesDir, FILE).delete()
        runCatching { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(ALIAS) }
    }
}
