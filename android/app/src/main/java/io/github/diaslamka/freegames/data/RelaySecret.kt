package io.github.diaslamka.freegames.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Le secret du relais, chiffre par une cle du Keystore Android.
 *
 * La cle ne sort jamais du Keystore (materiel quand le telephone en a) : le
 * fichier `relais.bin` ne se lit qu'avec elle, sur ce telephone. Il n'est pas
 * dans l'etat de l'appli, pas dans l'export, et la sauvegarde du telephone
 * est coupee (allowBackup=false).
 */
object RelaySecret {
    private const val ALIAS = "fgc-relais"
    private const val FILE = "relais.bin"

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

    fun save(context: Context, p: Relay.Pairing) {
        val clair = buildJsonObject { put("secret", p.secret); put("server", p.server); put("dev", p.dev) }.toString()
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val out = c.iv + c.doFinal(clair.toByteArray(Charsets.UTF_8))
        val f = File(context.filesDir, FILE)
        val tmp = File(context.filesDir, "$FILE.tmp")
        tmp.writeBytes(out)
        if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
    }

    fun load(context: Context): Relay.Pairing? = try {
        val all = File(context.filesDir, FILE).takeIf { it.exists() }?.readBytes()
        if (all == null || all.size < 12 + 16) {
            null
        } else {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, all.copyOfRange(0, 12)))
            val j = parseJson(String(c.doFinal(all.copyOfRange(12, all.size)), Charsets.UTF_8))
            val secret = j["secret"].str
            val server = Relay.relayServer(j["server"].str)
            val dev = j["dev"].str
            if (secret != null && server != null && dev != null) Relay.Pairing(secret, server, dev) else null
        }
    } catch (_: Exception) {
        null
    }

    fun clear(context: Context) {
        File(context.filesDir, FILE).delete()
        runCatching { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(ALIAS) }
    }
}
