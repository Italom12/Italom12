/**
 * Display input
 */
var inputIds = [document.getElementById('final')]
    
    btnpdf = document.getElementById('myguionpdf');
/**
 * ForEach loop to add content to an array to use it later
 */
inputIds.forEach((el, indx) =>{
    el.style.backgroundColor = "white";
    el.addEventListener('change', function(){
        //cambia a verde cuando hay texto
        el.style.backgroundColor = "lightgreen";
        bgas[indx] = el.value;
    });
});

/**
 * pdf printing
 */
btnpdf.onclick= function(){
    /**
     * crear PDF
     */
     var doc = new jsPDF('p', 'pt', 'letter');
     var margin = 10;
     var scale = (doc.internal.pageSize.width - margin * 2) / document.body.clientWidth;
     var scale_mobile = (doc.internal.pageSize.width - margin * 2) / document.body.getBoundingClientRect();
     var blocktxt = document.querySelectorAll('blocktxt');
     
     

     if(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)){
        // true for mobile device
        doc.html(document.querySelector('.contentinput'), {
            x: margin,
            y: margin,
            html2canvas: {
                scale: scale_mobile,
            },
            callback: function(doc){
                /* Export to a new window in explorer - works outside codepen in local enviroment*/
                // doc.output('dataurlnewwindow', {filename: 'fichero-pdf.pdf'});
              /* Save/Download the pdf to your pc*/
              doc.save('fichero-pdf.pdf');
            }
        });
      }else{
          //true for pc, false for mobile devices
        doc.html(document.querySelector('.contentinput'), {
            x: margin,
            y: margin,
            html2canvas: {
                scale: scale,
            },
            callback: function(doc){
              /* Export to a new window in explorer - works outside codepen in local enviroment */
                // doc.output('dataurlnewwindow', {filename: 'fichero-pdf.pdf'});
              /* Save/Download the pdf to your pc*/
              doc.save('fichero-pdf.pdf');
            }
        });
      }
    
    
 }

 function converterImagem(numero, largura, altura) {
    console.log("Convertendo imagem: " + numero);
    var receberArquivo = document.getElementById("imagem-usuario" + numero).files;

    if (receberArquivo.length > 0) {
        var carregarImagem = receberArquivo[0];
        var lerArquivo = new FileReader();

        lerArquivo.onload = function(arquivoCarregado) {
            var imagemBase64 = arquivoCarregado.target.result; 

            var novaImagem = document.createElement('img');
            novaImagem.src = imagemBase64;
            novaImagem.width = largura;  // Defina a largura desejada
            novaImagem.height = altura; // Defina a altura desejada

            document.getElementById("apresentar-imagem" + numero).innerHTML = novaImagem.outerHTML;
        }

        lerArquivo.readAsDataURL(carregarImagem);
    }
}
