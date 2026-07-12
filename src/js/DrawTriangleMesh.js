/**
 * Created by LMW on 2015/7/24.
 * 该程序用于加载给定顶点和三角形索引的三角网的创建
 * 其中着色采用的高程区间的分层设色
 * 三角形面片统一计算的 没有采用分布计算 当然如果要分布计算则需要把顶点重复使用
 */
 //画三角网依赖MultiColorTriangleAppearance模块
import * as Cesium from 'cesium';
import MultiColorTriangleAppearance from './Plugin/MultiColorTriangleAppearance.js'
    "use strict";
    
    var floodCenterPosition=null;
    var modelMatrix=null;
    var gridCellSize=20;
    var headingOffsetRadians=0;
    
    var DrawTriangleMesh=function (json){

        var colorRamp64 =[[182,237,240],[178,231,237],[178,228,237],[174,222,235],[174,219,235],[169,213,232],[167,210,232],[165,205,230],[161,200,227],[161,197,227],[157,191,224],[155,187,224],[153,183,222],[151,179,222],[147,175,219],[145,170,217],[143,166,217],[139,162,214],[139,159,214],[135,155,212],[133,150,212],[132,147,209],[128,142,207],[126,139,207],[122,133,204],[122,132,204],[119,127,201],[115,122,199],[113,119,199],[110,116,196],[110,114,196],[107,109,194],[105,106,194],[101,101,191],[98,98,189],[98,96,189],[93,91,186],[93,89,186],[88,84,184],[86,81,181],[83,78,181],[82,75,179],[80,73,179],[76,69,176],[73,66,173],[70,62,173],[69,60,171],[66,56,171],[63,54,168],[59,50,166],[58,48,166],[54,44,163],[52,42,163],[49,39,161],[47,36,158],[44,33,158],[39,31,156],[37,28,156],[33,24,153],[28,21,150],[26,20,150],[21,16,148],[16,13,148],[9,9,145]];
        // var colorRamp64 =[[247,239,205],[247,238,202],[247,238,197],[247,236,192],[245,233,186],[244,231,180],[244,229,174],[243,227,170],[243,225,169],[240,223,169], [240,221,167],[239,220,165],[239,220,163],[237,219,162],[237,217,160],[235,215,158],[235,213,152],[233,211,146],[233,209,140],[231,207,136],[230,206,130],[228,204,124],[227,202,118],[225,200,112],[225,198,106],[224,196,100],[224,194,94], [223,192,88],[223,190,82],[221,188,76],[220,186,70],[220,184,66],[220,182,62],[219,180,60],[218,176,58],[218,174,56], [217,170,52],[216,168,48],[216,166,44],[215,165,40], [215,164,38], [214,163,36],[214,162,34],[213,161,32],[212,160,30], [211,164,28],[210,163,26],[209,162,22], [207,161,20],[205,160,18],[203,159,18],[201,158,16],[198,157,16],[196,156,14],[195,155,12],[193,154,10],[190,153,9], [189,151,8],[188,150,6],[187,149,5],[186,148,4],[186,147,3],[186,116,1],[184,145,0]];
        var vertexArry=new Float64Array(json.Depth[0].length*3);//顶点数组(v1,v2,v3)
        var colorArray=new Uint8Array(json.Depth[0].length*4);//顶点颜色数组(R,G,B,A)
        var triiIndex=new Uint32Array(json.Face.length);//三角网的三角索引（使用32位避免大数据溢出）

        var colorIndex=-1;//颜色位置

        for(var i= 0,i_up=json.Depth[0].length;i<i_up;i++){

            //计算每个元胞点的位置，第一个点的位置(5*20,153*20, 2866+0)
            // vertexArry[i*3]=json.Vector[i*3+0]*20; 
            // vertexArry[i*3+1]=json.Vector[i*3+1]*20;
            vertexArry[i*3]=json.Vector[i*3+0]*gridCellSize; 
            vertexArry[i*3+1]=json.Vector[i*3+1]*gridCellSize;
            vertexArry[i*3+2]=json.Vector[i*3+2]+json.Depth[0][i]; //此处调整水位的高度
            //vertexArry[i*3+2]=json.Vector[i*3+2]-50;
            //Depth[1][1]表示最大水深值，当前水深值/最大水深值*颜色总数
            var maxDepth = json.Depth[1][1] || 1;
            colorIndex=Math.floor(json.Depth[0][i]/maxDepth*64); //向下取整得到颜色数组
            colorIndex= (64==colorIndex) ? 63: colorIndex;

            colorArray[i*4]=colorRamp64[colorIndex][0]; //顶点对应的颜色
            colorArray[i*4+1]=colorRamp64[colorIndex][1];
            colorArray[i*4+2]=colorRamp64[colorIndex][2];
            colorArray[i*4+3]=255*1.0; //透明度
        }

        //修改三角网中三角形的方向 修改方向时其实只要改变三角形首尾顶点位置即可
        for(i= 0,i_up=json.Face.length/3;i<i_up;i++){
            triiIndex[i*3] = json.Face[i*3+2];
            triiIndex[i*3+1] = json.Face[i*3+1];
            triiIndex[i*3+2] = json.Face[i*3];
        }

        //设置geometry中的属性(属性、索引、图元类型和包围盒)；
        //GeometryAttributes中设置顶点的位置和颜色，其中vertexArry存储的是顶点数组，colorArray存储的颜色数组
        var attributes=new Cesium.GeometryAttributes({
            position : new Cesium.GeometryAttribute({
                componentDatatype : Cesium.ComponentDatatype.DOUBLE,
                componentsPerAttribute : 3,
                values : vertexArry
            }),
            color : new Cesium.GeometryAttribute({
                componentDatatype : Cesium.ComponentDatatype.UNSIGNED_BYTE,
                normalize : true,
                componentsPerAttribute : 4,
                values : colorArray
            })
        });

        // Cesium's primitive pipeline uses the computed normal data to produce
        // the compressedAttributes expected by this custom appearance.
        var meshGeo=Cesium.GeometryPipeline.computeNormal(new Cesium.Geometry({
            attributes : attributes,
            indices : triiIndex,
            primitiveType : Cesium.PrimitiveType.TRIANGLES,
            boundingSphere : Cesium.BoundingSphere.fromVertices(vertexArry)
        }));

        var heading = Cesium.Math.PI_OVER_TWO;;
        var pitch = 0.0;
        var roll = 0.0;
        var Transforms=Cesium.Transforms;
        var Ellipsoid=Cesium.Ellipsoid;
        var HeadingPitchRoll=Cesium.HeadingPitchRoll;
        var hpRoll = new HeadingPitchRoll(Cesium.Math.PI_OVER_TWO + headingOffsetRadians,0.0,0.0);
       // var hpRoll = new HeadingPitchRoll(Cesium.Math.PI_OVER_TWO+0.002,0.001,0.0002); //此处是用于调整Bonn洪水的方向
        // var hpRoll = new HeadingPitchRoll(Cesium.Math.PI_OVER_TWO+0.001,0.0,0.0);
        modelMatrix=Transforms.headingPitchRollToFixedFrame(floodCenterPosition, hpRoll, Ellipsoid.WGS84, Transforms.eastNorthUpToFixedFrame);
       // var modelMatrix = Cesium.Transforms.headingPitchRollToFixedFrame(floodCenterPosition, heading, pitch, roll)




       //几何图形实例, geometry-几何形状, modelMatrix-模型矩阵，将几何图形从模型坐标转换为世界坐标
       //GeometryInstance是Geometry的容器，多个Instance可以共用一个Geometry
        var meshInstance=new Cesium.GeometryInstance({
            geometry : meshGeo,
            id: 'flood',
            modelMatrix : modelMatrix,
            colorsPerVertex: true,
            //attributes : {color : Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.WHITE)}
        });

        

        //绘制图元, primitive包括几何和外观
        var primitive = new Cesium.Primitive({
            geometryInstances : meshInstance,
            appearance:new MultiColorTriangleAppearance({
                translucent : false, //是否透明
                faceForward : true,  //设置为true时，片段着色器会根据需要翻转表面法线
                closed : false, //当true时，几何图形将被关闭
                renderState: {  //可选的渲染状态
                    depthTest : {
                        enabled : true,
                        func : Cesium.DepthFunction.LESS
                    },
                    depthMask:true,
                    //cull : {
                    //    enabled : true,
                    //    face : Cesium.CullFace.BACK
                    //}
                }
            }),
            asynchronous: false,
            //使用默认的PerInstanceColorAppearance同样可以渲染，带有颜色属性的GeometryInstance实例的外观
            // appearance: new Cesium.PerInstanceColorAppearance({
            //     translucent : false, //是否透明
            // }),
            show: true
        });

        try {
            if (meshGeo && meshGeo.boundingSphere) {
                var worldCenter = new Cesium.Cartesian3();
                Cesium.Matrix4.multiplyByPoint(modelMatrix, meshGeo.boundingSphere.center, worldCenter);
                primitive._boundingSphereWorld = new Cesium.BoundingSphere(worldCenter, meshGeo.boundingSphere.radius);
            }
        } catch (e) {
            console.warn('[DrawTriangleMesh] compute world bounding sphere failed', e);
        }

        return primitive;
    }

    DrawTriangleMesh.setFloodCenterPosition=function (position){
  floodCenterPosition=position;
       //floodCenterPosition={x:350311.60932516, y:5587483.1245015,z:4918551.951255279} //此处可以改变洪水表面的位置，X调整高度，y调整左右偏移量，z调整上下偏移量
        console.log(floodCenterPosition)
    };

    DrawTriangleMesh.setFloodMatrx=function (matrix){
        modelMatrix=matrix;
    };

    DrawTriangleMesh.setGridCellSize=function (size){
        if(typeof size==='number' && isFinite(size) && size>0){
            gridCellSize=size;
        }
    };

    DrawTriangleMesh.setHeadingOffsetDegrees=function (degrees){
        if(typeof degrees==='number' && isFinite(degrees)){
            headingOffsetRadians=Cesium.Math.toRadians(degrees);
        }
    };

    DrawTriangleMesh.getCurrentModelMatrix=function (){
        return modelMatrix ? Cesium.Matrix4.clone(modelMatrix, new Cesium.Matrix4()) : null;
    };

    DrawTriangleMesh.worldToFloodGrid=function (position){
        if(!position || !modelMatrix || !(gridCellSize>0)){
            return null;
        }

        var inverseMatrix = Cesium.Matrix4.inverse(modelMatrix, new Cesium.Matrix4());
        var localPosition = Cesium.Matrix4.multiplyByPoint(inverseMatrix, position, new Cesium.Cartesian3());
        return {
            x: localPosition.x / gridCellSize,
            y: localPosition.y / gridCellSize,
            z: localPosition.z,
            localX: localPosition.x,
            localY: localPosition.y,
            cellSize: gridCellSize
        };
    };

    DrawTriangleMesh.createMeshPrimitive=function (options){
        var mesh = options.mesh;
        var stats = options.stats || mesh.stats || {};
        var alpha = typeof options.alpha === 'number' ? options.alpha : 0.78;
        var heightScale = typeof options.heightScale === 'number' ? options.heightScale : 1;
        var surfaceOffset = typeof options.surfaceOffset === 'number' ? options.surfaceOffset : 1.2;
        var terrainHeights = options.terrainHeights;
        var colorRamp = Array.isArray(options.colorRamp) && options.colorRamp.length
            ? options.colorRamp
            : ['#d9fbff', '#87d8f5', '#3b9fe0', '#1766bd', '#102f83'];
        var vertexCount = Array.isArray(mesh.values) ? mesh.values.length : 0;
        var packedPositions = new Float64Array(vertexCount * 3);
        var colors = new Uint8Array(vertexCount * 4);

        function hexToRgb(color){
            var normalized = String(color).replace('#', '');
            if(normalized.length === 3){
                normalized = normalized.split('').map(function(char){ return char + char; }).join('');
            }
            var value = Number.parseInt(normalized, 16);
            return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
        }

        function colorFor(value, minValue, maxValue){
            var ramp = colorRamp.map(function(color){
                return Array.isArray(color) ? color : hexToRgb(color);
            });
            var range = Math.max(maxValue - minValue, 0.000001);
            var ratio = Cesium.Math.clamp((value - minValue) / range, 0, 1);
            var scaled = ratio * (ramp.length - 1);
            var lower = Math.floor(scaled);
            var upper = Math.min(lower + 1, ramp.length - 1);
            var t = scaled - lower;
            return [
                Math.round(Cesium.Math.lerp(ramp[lower][0], ramp[upper][0], t)),
                Math.round(Cesium.Math.lerp(ramp[lower][1], ramp[upper][1], t)),
                Math.round(Cesium.Math.lerp(ramp[lower][2], ramp[upper][2], t)),
                Math.round(Cesium.Math.clamp(alpha, 0, 1) * 255)
            ];
        }

        var minValue = Number.isFinite(stats.minValue) ? stats.minValue : Number.POSITIVE_INFINITY;
        var maxValue = Number.isFinite(stats.maxValue) ? stats.maxValue : Number.NEGATIVE_INFINITY;
        if(!Number.isFinite(minValue) || !Number.isFinite(maxValue)){
            for(var valueIndex = 0; valueIndex < vertexCount; valueIndex += 1){
                var statValue = Number(mesh.values[valueIndex]) || 0;
                minValue = Math.min(minValue, statValue);
                maxValue = Math.max(maxValue, statValue);
            }
        }
        if(!Number.isFinite(minValue) || !Number.isFinite(maxValue)){
            minValue = 0;
            maxValue = 1;
        }

        for(var index = 0; index < vertexCount; index += 1){
            var lon = Number(mesh.positions[index * 2]);
            var lat = Number(mesh.positions[index * 2 + 1]);
            var value = Number(mesh.values[index]) || 0;
            var terrainHeight = terrainHeights ? (Number(terrainHeights[index]) || 0) : 0;
            var height = terrainHeight + Math.max(0, value) * heightScale + surfaceOffset;
            var cartesian = Cesium.Cartesian3.fromDegrees(lon, lat, height);
            var color = colorFor(value, minValue, maxValue);
            Cesium.Cartesian3.pack(cartesian, packedPositions, index * 3);
            colors.set(color, index * 4);
        }

        var indices = Cesium.IndexDatatype.createTypedArray(vertexCount, mesh.triangles.length);
        for(index = 0; index < mesh.triangles.length; index += 3){
            indices[index] = mesh.triangles[index + 2];
            indices[index + 1] = mesh.triangles[index + 1];
            indices[index + 2] = mesh.triangles[index];
        }

        var geometry = new Cesium.Geometry({
            attributes : new Cesium.GeometryAttributes({
                position : new Cesium.GeometryAttribute({
                    componentDatatype : Cesium.ComponentDatatype.DOUBLE,
                    componentsPerAttribute : 3,
                    values : packedPositions
                }),
                color : new Cesium.GeometryAttribute({
                    componentDatatype : Cesium.ComponentDatatype.UNSIGNED_BYTE,
                    normalize : true,
                    componentsPerAttribute : 4,
                    values : colors
                })
            }),
            indices : indices,
            primitiveType : Cesium.PrimitiveType.TRIANGLES,
            boundingSphere : Cesium.BoundingSphere.fromVertices(packedPositions)
        });

        var primitive = new Cesium.Primitive({
            geometryInstances : new Cesium.GeometryInstance({
                geometry : geometry,
                id: options.id || 'flood-mesh',
                colorsPerVertex: true
            }),
            appearance:new Cesium.PerInstanceColorAppearance({
                flat: true,
                translucent: alpha < 1,
                renderState: {
                    depthTest: {
                        enabled: true
                    },
                    depthMask: false,
                    blending: Cesium.BlendingState.ALPHA_BLEND
                }
            }),
            asynchronous: false,
            show: true
        });

        if(geometry && geometry.boundingSphere){
            primitive._boundingSphereWorld = Cesium.BoundingSphere.clone(geometry.boundingSphere);
        }

        return primitive;
    };
   export default DrawTriangleMesh;
